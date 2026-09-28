import type Koa from 'koa';
import {
  applyServerSearchPageBound,
  buildSearchErrorResponse,
  DURING_PRERENDER_HEADER,
  ifNoneMatchMatches,
  isItemLegSearch,
  parseSearchRequestPayload,
  parseSearchEntryQueryFromPayload,
  runWithSearchTimeBudget,
  sanitizeConsumingRealmHeader,
  SearchBoundError,
  SearchRequestError,
  searchEntryRealms,
  sanitizeLoggingCorrelationId,
  SupportedMimeType,
  X_BOXEL_CONSUMING_REALM_HEADER,
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
  RequestTimings,
  emitSearchTiming,
  describeSearchShape,
  emitSearchShape,
  LinkShapePolicy,
  requestedLinkShape,
  rowClassForPageSize,
  X_BOXEL_LINK_SHAPE_HEADER,
  type LinkShapeDecision,
  type Query,
  type SearchShapeCacheOutcome,
  type SearchShapeDescriptor,
  type SearchShapeLinkMode,
} from '@cardstack/runtime-common';
import {
  attributeSearchRequest,
  fetchRequestFromContext,
  releaseSearchAdmission,
  sendResponseForBadRequest,
  sendResponseForNotFound,
  setContextResponse,
  withSearchConnectionTenant,
} from '../middleware/index.ts';
import {
  getMultiRealmAuthorization,
  getSearchRequestPayload,
} from '../middleware/multi-realm-authorization.ts';
import { resolveRealmsForFederatedRequest } from '../lib/realm-routing.ts';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler.ts';
import type { JobScopedSearchCache } from '../job-scoped-search-cache.ts';
import { LiveSearchCache } from '../live-search-cache.ts';
import {
  resolveSearchGenerations,
  warmSearchTypeWatermarkKeys,
} from '../search-type-watermarks.ts';
import type {
  CodeRef,
  DBAdapter,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  errorsDocument,
  isNamedQueryPayload,
  isOperationFailure,
  resolveNamedQuery,
} from '@cardstack/runtime-common/card-operations';
import {
  PRERENDER_JOB_ID_HEADER,
  PRERENDER_JOB_PRIORITY_HEADER,
  sanitizeJobPriorityHeader,
  sanitizePrerenderJobId,
} from '../prerender/prerender-constants.ts';

// Response header naming how the live-search cache satisfied a request:
// `miss` (fresh compute), `join` (awaited an identical in-flight compute), or
// `hit` (served from the TTL window). Diagnostic only — the body is
// byte-identical across the three. Added to the CORS `exposeHeaders` list
// (server.ts) so a cross-origin browser caller can read it, not just
// server-side supertest/curl.
export const LIVE_SEARCH_CACHE_HEADER = 'x-boxel-live-search-cache';

// The federated search: the entry wire model over every requested
// realm. Parses the entry-rooted query (the `item.` membership query,
// the `htmlQuery` binding, the sparse fieldset), fans out to each realm's
// `searchEntries`, and merges the per-realm documents (`included` deduped by
// `(type, id)`). Cache + ETag ride the job-scoped search-cache protocol; the
// inner key folds every request member that changes the body — the membership
// query plus the applied htmlQuery, the fieldset, and any `cardUrls` subset —
// so two requests differing on any of them get distinct entries + ETags.
export default function handleSearch(opts: {
  reconciler: RealmRegistryReconciler;
  searchCache?: JobScopedSearchCache;
  // Reads each searched realm's generation fingerprints (the freshness signal
  // the live-search cache keys on). Required — every route wiring passes it.
  dbAdapter: DBAdapter;
  // Resolves a query's type anchors to the `realm_type_generations` keys the
  // live-search cache key is scoped by. The process-wide network every realm
  // is mounted on, so a module named by prefix, real URL or virtual alias
  // normalizes to the one spelling the indexer stamps.
  virtualNetwork: VirtualNetwork;
  // Injectable per test; when unset the handler builds one with production
  // defaults. A test supplies a `ttlMs: 0` cache (coalescing on, retention
  // off) to make two sequential callers each compute.
  liveSearchCache?: LiveSearchCache;
  // Decides how much of each result's link graph the response carries. The
  // same policy instance the realms are constructed with, since the fan-out
  // builds its own opts rather than reading them off a realm — and since the
  // level is held per realm, sharing the instance is what keeps a federated
  // search and that realm's own routes on one answer rather than two
  // independently drifting ladders.
  linkShapePolicy?: LinkShapePolicy;
}): (ctxt: Koa.Context) => Promise<void> {
  let { reconciler, searchCache, dbAdapter, virtualNetwork } = opts;
  let linkShapePolicy = opts.linkShapePolicy ?? LinkShapePolicy.pinned('full');
  let liveSearchCache = opts.liveSearchCache ?? new LiveSearchCache();
  return async function (ctxt: Koa.Context) {
    let { realmList, user } = getMultiRealmAuthorization(ctxt);
    let payload = getSearchRequestPayload(ctxt);
    if (isNamedQueryPayload(payload)) {
      // Resolving reads the declaration's definition, so it draws on the
      // database as a search of the realms the request names, the same as the
      // search it resolves to.
      let named = payload;
      let resolved = await withSearchConnectionTenant(ctxt, realmList, () =>
        resolveNamedSearch(ctxt, named, realmList, user),
      );
      if (!resolved) {
        return;
      }
      payload = resolved;
      realmList = resolved.realms!;
    }
    // The realms this search names are known from here: each one's link-shape
    // level follows the requests that name it, and the database connections
    // the search draws on are shared out by them.
    attributeSearchRequest(ctxt, realmList);
    await withSearchConnectionTenant(ctxt, realmList, () =>
      respond(ctxt, realmList, payload),
    );
  };

  // The ad-hoc query a named one resolves to, or nothing once the refusal has
  // been answered. The declaration is read through a realm the request names:
  // one this process already holds where there is one, so resolving mounts a
  // realm only when none of them is mounted. For a type whose module this
  // server serves, the definition entry belongs to the module's own realm
  // whichever realm reads it; for one served elsewhere, it is read with the
  // reading realm owner's credentials. The realms the query may search are the
  // ones the middleware authorized, so resolving it never widens what the
  // caller can reach.
  async function resolveNamedSearch(
    ctxt: Koa.Context,
    payload: Record<string, unknown>,
    realmList: string[],
    user: string | undefined,
  ) {
    let resolvingRealm =
      realmList.map((url) => reconciler.mounted.get(url)).find(Boolean) ??
      (
        await resolveRealmsForFederatedRequest(
          reconciler,
          realmList.slice(0, 1),
        )
      )[0];
    if (!resolvingRealm) {
      await sendResponseForNotFound(
        ctxt,
        `Realm not available to resolve a named query: ${realmList[0]}`,
      );
      return undefined;
    }
    try {
      return await resolveNamedQuery(resolvingRealm.operationCore, payload, {
        actor: user,
        realms: realmList,
        duringRender: ctxt.get(DURING_PRERENDER_HEADER).length > 0,
      });
    } catch (e) {
      if (!isOperationFailure(e)) {
        throw e;
      }
      await setContextResponse(
        ctxt,
        new Response(JSON.stringify(errorsDocument(e.error)), {
          status: e.error.status,
          headers: { 'content-type': SupportedMimeType.CardJson },
        }),
      );
      return undefined;
    }
  }

  async function respond(
    ctxt: Koa.Context,
    realmList: string[],
    payload: unknown,
  ) {
    let handlerStart = Date.now();
    // Slots the query-shape line is assembled from. `shape` is filled in as
    // soon as the query parses — a request that never gets that far has no
    // shape to report — and the rest are stamped by whichever path answers.
    let shape: SearchShapeDescriptor | undefined;
    let cacheOutcome: SearchShapeCacheOutcome = 'none';
    let resultCount: number | null = null;
    let resultTotal: number | null = null;
    let resultIncomplete: boolean | null = null;
    let loggingCorrelationId = sanitizeLoggingCorrelationId(
      ctxt.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
    );
    let timings =
      loggingCorrelationId !== null ? new RequestTimings() : undefined;

    let parsed;
    let request = await fetchRequestFromContext(ctxt);
    try {
      let parseRequest = async () =>
        parseSearchEntryQueryFromPayload(
          payload === undefined
            ? await parseSearchRequestPayload(request)
            : payload,
        );
      parsed = timings
        ? await timings.time('parse', parseRequest)
        : await parseRequest();
    } catch (e) {
      if (e instanceof SearchRequestError) {
        // `invalid-query` / `invalid-render` are client request-shape errors
        // → the JSON:API search-error body; anything else (bad method / JSON)
        // → a plain bad request, the same split as the other search handlers.
        if (e.code === 'invalid-query' || e.code === 'invalid-render') {
          await setContextResponse(ctxt, buildSearchErrorResponse(e.message));
        } else {
          await sendResponseForBadRequest(ctxt, e.message);
        }
        return;
      }
      throw e;
    }

    let cacheOnlyDefinitions = ctxt.get(DURING_PRERENDER_HEADER).length > 0;
    // Inside a prerender the search skips the `loadLinks` relationship-
    // assembly pass entirely: the host re-resolves every result from its raw
    // card+source file, so the transitive `included[]` expansion is
    // throwaway work in this path. Same gating as `cacheOnlyDefinitions`.
    //
    // This is also what keeps the assembled-resource budget off a render's
    // search: the pass the budget bounds does not run at all here, so there is
    // nothing to exempt. The budget's exemption is carried by the routes that
    // do run the pass during a render — the card+html entry leg.
    let omitIncluded = cacheOnlyDefinitions;
    let jobPriority = sanitizeJobPriorityHeader(
      ctxt.get(PRERENDER_JOB_PRIORITY_HEADER),
    );
    let prerenderJobId = sanitizePrerenderJobId(
      ctxt.get(PRERENDER_JOB_ID_HEADER),
    );
    // Two bounds are enforced server-side on the live item leg (never during
    // prerender, never on the prerendered-HTML leg): a hard page-size ceiling
    // (applied just below) and the wall-clock time budget (further down). Both
    // hold for every caller — a wall-clock cutoff can't live client-side, and a
    // page ceiling must bound the result set even when the client card cap was
    // skipped. The realms fan-out and concurrency caps stay client-side on the
    // card `@context` surface, since the trusted host must be free to exceed
    // them.
    let itemLegBounded =
      isItemLegSearch(parsed.fieldset) && !cacheOnlyDefinitions;

    // The server page bounds. An absent item-leg page is clamped to the default
    // so the query carries a LIMIT; an explicit one is honored to the absolute
    // maximum and clamped to it above, which is logged. Either way the server
    // never assembles/serializes an unbounded result set, and the true match
    // count rides `meta.page.total` so a short page is visible to the caller.
    if (itemLegBounded) {
      parsed.itemQuery = applyServerSearchPageBound(parsed.itemQuery);
    }

    // How much of each result's link graph this response carries. Decided
    // after the page clamp above, since the clamped page is the only bound on
    // this search's result count and the cost of a closure scales with it —
    // and decided before the cache key below, which folds the served mode
    // because the two modes are two different response bodies.
    //
    // A prerender is already asking for less than either shape and never
    // reaches the policy; its `linkMode` stays `prerender` and it reports no
    // decision inputs, because none were consulted.
    let linkShapeDecision: LinkShapeDecision | null = cacheOnlyDefinitions
      ? null
      : linkShapePolicy.decideAcross({
          realms: realmList,
          rowClass: rowClassForPageSize(
            parsed.itemQuery.page?.size as number | undefined,
          ),
          requested: requestedLinkShape(ctxt.get(X_BOXEL_LINK_SHAPE_HEADER)),
        });
    let resolveLinksOnly = linkShapeDecision?.mode === 'links-only';
    let searchOpts: {
      cacheOnlyDefinitions?: true;
      omitIncluded?: true;
      resolveLinksOnly?: true;
      priority?: number;
    } = {};
    if (cacheOnlyDefinitions) searchOpts.cacheOnlyDefinitions = true;
    if (omitIncluded) searchOpts.omitIncluded = true;
    if (resolveLinksOnly) searchOpts.resolveLinksOnly = true;
    if (jobPriority !== null) searchOpts.priority = jobPriority;

    // The inner cache key: the membership query is the key's `query` member
    // (canonicalized by the cache), and every other body-changing request
    // member folds into `opts` — the parsed fieldset, the applied (bound or
    // defaulted) htmlQuery, and any non-empty `cardUrls` subset (an empty
    // array is a no-op filter, so folding `[]` would fragment the cache
    // against an equivalent request that omits it). The htmlQuery folds only
    // when the fieldset puts the html branch in play: a fieldset without
    // `html` makes it inert — the body is identical regardless — so keying
    // on it would fragment the cache and split ETags across equivalent
    // responses.
    let cacheKeyOpts: Record<string, unknown> = {
      ...searchOpts,
      fieldset: parsed.fieldset,
    };
    if (parsed.fieldset.html) {
      cacheKeyOpts.htmlQuery = parsed.htmlQuery;
    }
    if (parsed.cardUrls?.length) {
      cacheKeyOpts.cardUrls = parsed.cardUrls;
    }
    // `scope` changes which row kinds the response contains, so it must key the
    // cache — otherwise a `scope: 'cards'` and a `scope: 'all'` request for the
    // same query would collide on one ETag/body. An explicit `'all'` folds the
    // same as an absent scope (both mean the default), so the two spellings
    // share one cache entry/ETag — which also keeps the key identical to
    // pre-scope requests.
    if (parsed.scope && parsed.scope !== 'all') {
      cacheKeyOpts.scope = parsed.scope;
    }

    // `loggingCorrelationId` / `timings` deliberately stay OUT of the
    // cache-key opts (per-request values would make every key unique) and
    // ride the run-time opts instead.
    let runSearchOpts = {
      ...searchOpts,
      ...(loggingCorrelationId !== null ? { loggingCorrelationId } : {}),
      ...(timings ? { timings } : {}),
    };

    let consumingRealm = sanitizeConsumingRealmHeader(
      ctxt.get(X_BOXEL_CONSUMING_REALM_HEADER),
    );

    // Built from the query the search will actually run — the item-leg page
    // ceiling above has already been applied — so the reported page size is
    // the one the index saw, not the one the caller asked for. The link mode
    // travels with it because the same query costs differently in each, and no
    // header on the request is a reliable stand-in: `x-boxel-during-prerender`
    // is raised by the module, file-extract and command-runner routes too,
    // while the job and consuming-realm headers ride only the render route's
    // visit.
    let linkMode: SearchShapeLinkMode = cacheOnlyDefinitions
      ? 'prerender'
      : resolveLinksOnly
        ? 'links-only'
        : 'full';
    shape = describeSearchShape({
      query: parsed,
      realms: realmList,
      linkMode,
      ...(linkShapeDecision
        ? {
            requestedLinkMode: linkShapeDecision.requested,
            linkShapeLoad: linkShapeDecision.load,
            linkShapeLevel: linkShapeDecision.level,
            linkShapeRowClass: linkShapeDecision.rowClass,
          }
        : {}),
      correlationId: loggingCorrelationId,
      jobId: prerenderJobId,
      consumingRealm,
      jobPriority,
    });

    // Lazy-mount inside runSearch so cache hits (304 / cached body) skip the
    // lazy-mount work entirely.
    let runSearch = async () => {
      let doRun = async (signal?: AbortSignal) => {
        let resolveRealms = () =>
          resolveRealmsForFederatedRequest(reconciler, realmList, {
            consumingRealm,
          });
        let realmInstances = timings
          ? await timings.time('resolveRealms', resolveRealms)
          : await resolveRealms();
        let doc = await searchEntryRealms(realmInstances, parsed, {
          ...runSearchOpts,
          ...(signal ? { signal } : {}),
        });
        // If the budget already fired, skip stringifying a document we're about
        // to discard (the time-budget race has already resolved with the 408).
        signal?.throwIfAborted();
        // Counted here rather than off the response because only this path
        // holds a document: a cache hit, a join and a 304 all answer from a
        // body another request computed, and they report no counts at all
        // rather than re-parsing one to invent them. An incomplete merge
        // reports no total either — it sums only the realms that answered, so
        // publishing it would claim a number over the rows whose absence made
        // it unknowable.
        resultCount = doc.data?.length ?? 0;
        resultIncomplete = doc.meta.incomplete === true;
        resultTotal = resultIncomplete ? null : (doc.meta.page?.total ?? null);
        // Serialize compact: an entry doc can run to many MB, so indentation
        // whitespace is pure wire overhead the consumer parses straight back off.
        let stringify = async () => JSON.stringify(doc);
        return timings
          ? await timings.time('stringify', stringify)
          : stringify();
      };
      // Cut an over-budget item-leg search off (408) rather than run it to
      // completion; the signal stops the `loadLinks` fan-out promptly.
      return itemLegBounded ? runWithSearchTimeBudget(doRun) : doRun();
    };

    // Called once by whichever path answers the request — a fresh compute, any
    // of the cache outcomes, a 304, the time-budget cutoff, or a throw. The
    // stage timeline rides the caller's correlation id and so is emitted only
    // for an instrumented request; the query-shape line is emitted for every
    // request that got far enough to have a shape, which is what makes a load
    // event replayable from logs alone.
    let emitTelemetry = (override?: { status?: number }) => {
      if (timings && loggingCorrelationId !== null) {
        emitSearchTiming(
          `corr=${loggingCorrelationId}` +
            (prerenderJobId ? ` job=${prerenderJobId}` : '') +
            ` handler=${Date.now() - handlerStart}ms ` +
            timings.toLogFragment(),
        );
      }
      if (shape) {
        emitSearchShape({
          ...shape,
          results: resultCount,
          total: resultTotal,
          incomplete: resultIncomplete,
          cache: cacheOutcome,
          status: override?.status ?? ctxt.status,
          totalMs: Date.now() - handlerStart,
        });
      }
    };

    let jobId = searchCache ? prerenderJobId : null;
    try {
      await respondWithJobScopedSearchCache(ctxt, {
        searchCache,
        jobId,
        consumingRealm,
        realms: realmList,
        query: parsed.itemQuery,
        opts: cacheKeyOpts,
        runSearch,
        emitTelemetry,
        recordCacheOutcome: (outcome) => {
          cacheOutcome = outcome;
        },
        liveSearch: {
          cache: liveSearchCache,
          dbAdapter,
          virtualNetwork,
          typeAnchors: parsed.typeAnchors,
          // Only realms this process already holds. Resolving an anchor's
          // canonical spelling must never be the thing that forces a mount —
          // this request may well be a cache hit, which skips mounting
          // entirely.
          mountedRealm: () => {
            for (let url of realmList) {
              let realm = reconciler.mounted.get(url);
              if (realm) {
                return realm;
              }
            }
            return undefined;
          },
        },
      });
    } catch (e) {
      // The per-request time budget fired inside `runSearch`. A bounded search
      // is never cacheable (cacheable ⟹ during-prerender ⟹ not bounded), so
      // this only surfaces on the fresh-compute path and leaves no cache entry.
      if (e instanceof SearchBoundError) {
        await setContextResponse(
          ctxt,
          buildSearchErrorResponse(e.message, e.status),
        );
        emitTelemetry();
        return;
      }
      // Koa answers an escaping throw with a 500 once the handler unwinds, so
      // report that rather than the status the context is still carrying.
      emitTelemetry({ status: 500 });
      throw e;
    }
  }
}

// The job-scoped cache + ETag/304 protocol for the federated search
// handler. Caching is gated on:
//   (a) `x-boxel-job-id` present and well-formed — only the indexer worker
//       stamps it; live user / API callers never carry it and so always see
//       fresh data,
//   (b) `x-boxel-consuming-realm` present and well-formed — the host's render
//       route only sets it during prerender.
// The caller reads both headers and passes `jobId` (already gated on a
// configured cache) and `consumingRealm`; `cacheable` is their AND.
//
// Cross-realm reads participate: within a single jobId, results are pinned to
// the first observation even if a peer realm swaps its `boxel_index`
// mid-batch — "one consolidated view of the realm-server's state per indexing
// batch". Same-process writes (the batch's own swap) still trip
// `Realm.update`'s onInvalidation, so the cache only freezes peer-realm swaps
// within the job's lifetime. `multiRealmAuthorization` has already validated
// read access to every realm, so the cache can't surface results across an
// authorization boundary.
//
// The inner key is `(realms, query, opts)`; `opts` is whatever the caller
// folds in — every request member that changes the body — so two requests
// differing on any of them get distinct entries + ETags. The ETag is
// opaque-but-deterministic over `(jobId, innerKey)`: identical inputs yield
// the same value for an entry's lifetime, and a different jobId yields a
// different value so a stale If-None-Match from a previous batch never matches
// a fresh entry. Both the ETag and the 304 path are reached only by cacheable
// callers; non-indexer traffic falls through to a plain fresh response.
async function respondWithJobScopedSearchCache(
  ctxt: Koa.Context,
  args: {
    searchCache: JobScopedSearchCache | undefined;
    jobId: string | null;
    consumingRealm: string | null;
    realms: string[];
    query: Query;
    opts: unknown;
    runSearch: () => Promise<string>;
    emitTelemetry?: () => void;
    // Which cache, if any, answered — reported before the response is sent so
    // the telemetry emitted alongside it carries the outcome.
    recordCacheOutcome?: (outcome: SearchShapeCacheOutcome) => void;
    liveSearch?: {
      cache: LiveSearchCache;
      dbAdapter: DBAdapter;
      virtualNetwork: VirtualNetwork;
      typeAnchors: CodeRef[] | undefined;
      mountedRealm: () => Realm | undefined;
    };
  },
): Promise<void> {
  let { searchCache, jobId, consumingRealm, realms, query, runSearch } = args;
  let emitTelemetry = args.emitTelemetry ?? (() => {});
  let recordCacheOutcome = args.recordCacheOutcome ?? (() => {});
  let cacheable = searchCache && jobId && consumingRealm;

  if (cacheable) {
    // Fold each realm's generation fingerprint (index + prerendered-HTML) into
    // the cache key so the ETag advances when either channel does — a cached
    // `304` can't pin an HTML-less or older-rendering result after newer HTML
    // lands. The consuming realm's rides along even when the query does not
    // search it: another writer's pass can commit to that realm while this
    // job runs, and the linked resources a result carries can live there.
    // Purely a key change: it only fragments the cache, and the body a miss
    // produces reflects the current DB state.
    let generations = await searchCache!.realmGenerations([
      ...new Set([...realms, consumingRealm!]),
    ]);
    let keyOpts = { ...(args.opts as Record<string, unknown>), generations };
    let expectedEtag = searchCache!.computeETag({
      jobId: jobId!,
      realms,
      query,
      opts: keyOpts,
    });
    let ifNoneMatch = ctxt.get('If-None-Match');
    if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, expectedEtag)) {
      // Only honor 304 when the cache still has the body — a TTL-evicted slot
      // whose ETag the caller happens to remember must fall through and
      // re-populate, otherwise a follow-up request would find nothing to
      // revalidate against.
      let cached = await searchCache!.getCached({
        jobId: jobId!,
        realms,
        query,
        opts: keyOpts,
      });
      if (cached !== undefined) {
        ctxt.status = 304;
        ctxt.set('ETag', expectedEtag);
        recordCacheOutcome('not-modified');
        emitTelemetry();
        return;
      }
    }
    let body = await searchCache!.getOrPopulate({
      jobId: jobId!,
      realms,
      query,
      opts: keyOpts,
      populate: runSearch,
      onOutcome: (decided) =>
        recordCacheOutcome(decided === 'hit' ? 'job-hit' : 'job-miss'),
    });
    await setContextResponse(
      ctxt,
      new Response(body, {
        headers: {
          'content-type': SupportedMimeType.CardJson,
          ETag: expectedEtag,
        },
      }),
    );
    emitTelemetry();
    return;
  }

  // The live (non-indexer) path: coalesce identical concurrent requests and
  // serve a short-TTL cache. The key folds in each realm's generation
  // fingerprints, scoped to the types this query's filter is anchored on — so
  // a swap on one of those types changes the key and the next request
  // recomputes, while a swap on a type the query cannot match leaves the entry
  // reachable. A query with no readable anchors, and one whose anchors have
  // not been resolved to their index keys yet, take the realm-wide
  // generation, which every index batch advances. See
  // `resolveSearchGenerations` for what the scoped key does and does not
  // cover; for a change outside the anchors the TTL is the staleness bound
  // rather than merely a retention bound.
  // Authorization is realm-scoped and was validated for this exact realm list
  // by `multiRealmAuthorization` before the handler ran, so a body computed
  // for one caller is byte-identical to what any other authorized caller
  // would compute.
  if (args.liveSearch) {
    // Off the critical path: resolves the anchors whose keys are cold or aged
    // out so a later request is scoped, and never blocks this one.
    warmSearchTypeWatermarkKeys({
      anchors: args.liveSearch.typeAnchors,
      virtualNetwork: args.liveSearch.virtualNetwork,
      mountedRealm: args.liveSearch.mountedRealm,
    });
    let generations = await resolveSearchGenerations(
      args.liveSearch.dbAdapter,
      realms,
      args.liveSearch.typeAnchors,
      args.liveSearch.virtualNetwork,
    );
    let { body, outcome } = await args.liveSearch.cache.getOrPopulate({
      realms,
      query,
      opts: { ...(args.opts as Record<string, unknown>), generations },
      populate: runSearch,
      // A joiner or a hit holds no result document of its own, so it stops
      // counting toward the search admission ceiling here rather than when
      // its response ends; the ceiling is then a bound on concurrent
      // computations, which is what holds the heap. The request itself stays
      // counted toward the link-shape policy's reading until its response
      // ends, because it goes on waiting for the computation it joined.
      onOutcome: (decided) => {
        recordCacheOutcome(decided);
        if (decided !== 'miss') {
          releaseSearchAdmission(ctxt);
        }
      },
    });
    // The body is a string the cache may be handing to many requests at once,
    // so it goes to Koa as-is. Wrapping it in a `Response` would encode it into
    // a stream that `setContextResponse` decodes back into a per-request copy;
    // this way a joiner's or a hit's cost on the way out is Koa's own write of
    // the shared string and nothing more.
    ctxt.status = 200;
    ctxt.set('content-type', SupportedMimeType.CardJson);
    ctxt.set(LIVE_SEARCH_CACHE_HEADER, outcome);
    ctxt.body = body;
    emitTelemetry();
    return;
  }

  let body = await runSearch();
  await setContextResponse(
    ctxt,
    new Response(body, {
      headers: { 'content-type': SupportedMimeType.CardJson },
    }),
  );
  emitTelemetry();
}
