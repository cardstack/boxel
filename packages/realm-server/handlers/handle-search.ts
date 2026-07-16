import type Koa from 'koa';
import {
  applySearchPageBound,
  assertRealmsBound,
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
  type Query,
} from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware/index.ts';
import {
  getMultiRealmAuthorization,
  getSearchRequestPayload,
} from '../middleware/multi-realm-authorization.ts';
import { resolveRealmsForFederatedRequest } from '../lib/realm-routing.ts';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler.ts';
import type { JobScopedSearchCache } from '../job-scoped-search-cache.ts';
import {
  PRERENDER_JOB_ID_HEADER,
  PRERENDER_JOB_PRIORITY_HEADER,
  sanitizeJobPriorityHeader,
  sanitizePrerenderJobId,
} from '../prerender/prerender-constants.ts';

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
}): (ctxt: Koa.Context) => Promise<void> {
  let { reconciler, searchCache } = opts;
  return async function (ctxt: Koa.Context) {
    let handlerStart = Date.now();
    let loggingCorrelationId = sanitizeLoggingCorrelationId(
      ctxt.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
    );
    let timings =
      loggingCorrelationId !== null ? new RequestTimings() : undefined;

    let { realmList } = getMultiRealmAuthorization(ctxt);

    let parsed;
    let request = await fetchRequestFromContext(ctxt);
    try {
      let parseRequest = async () => {
        let payload = getSearchRequestPayload(ctxt);
        if (payload === undefined) {
          payload = await parseSearchRequestPayload(request);
        }
        return parseSearchEntryQueryFromPayload(payload);
      };
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
    let omitIncluded = cacheOnlyDefinitions;
    let jobPriority = sanitizeJobPriorityHeader(
      ctxt.get(PRERENDER_JOB_PRIORITY_HEADER),
    );
    let prerenderJobId = sanitizePrerenderJobId(
      ctxt.get(PRERENDER_JOB_ID_HEADER),
    );
    let searchOpts: {
      cacheOnlyDefinitions?: true;
      omitIncluded?: true;
      priority?: number;
    } = {};
    if (cacheOnlyDefinitions) searchOpts.cacheOnlyDefinitions = true;
    if (omitIncluded) searchOpts.omitIncluded = true;
    if (jobPriority !== null) searchOpts.priority = jobPriority;

    // Hard resource bounds apply to the item leg only (the live serialization +
    // `loadLinks` path), and never to the realm-server's own during-prerender
    // traffic. The prerendered-HTML leg — the platform's grid / search sheet —
    // stays unbounded. Realms + page are validated up front (a 400 the author
    // can act on); the time budget wraps the actual search below.
    let bounded = isItemLegSearch(parsed.fieldset) && !cacheOnlyDefinitions;
    if (bounded) {
      try {
        assertRealmsBound(realmList);
        parsed.itemQuery = applySearchPageBound(parsed.itemQuery);
      } catch (e) {
        if (e instanceof SearchBoundError) {
          await setContextResponse(
            ctxt,
            buildSearchErrorResponse(e.message, e.status),
          );
          return;
        }
        throw e;
      }
    }

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
        // Serialize compact: an entry doc can run to many MB, so indentation
        // whitespace is pure wire overhead the consumer parses straight back off.
        let stringify = async () => JSON.stringify(doc);
        return timings
          ? await timings.time('stringify', stringify)
          : stringify();
      };
      // Cut an over-budget item-leg search off (408) rather than run it to
      // completion; the signal stops the `loadLinks` fan-out promptly.
      return bounded ? runWithSearchTimeBudget(doRun) : doRun();
    };

    let emitTimeline = () => {
      if (!timings || loggingCorrelationId === null) {
        return;
      }
      emitSearchTiming(
        `corr=${loggingCorrelationId}` +
          (prerenderJobId ? ` job=${prerenderJobId}` : '') +
          ` handler=${Date.now() - handlerStart}ms ` +
          timings.toLogFragment(),
      );
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
        emitTimeline,
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
        emitTimeline();
        return;
      }
      throw e;
    }
  };
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
    emitTimeline?: () => void;
  },
): Promise<void> {
  let { searchCache, jobId, consumingRealm, realms, query, runSearch } = args;
  let emitTimeline = args.emitTimeline ?? (() => {});
  let cacheable = searchCache && jobId && consumingRealm;

  if (cacheable) {
    // Fold each realm's generation fingerprint (index + prerendered-HTML) into
    // the cache key so the ETag advances when either channel does — a cached
    // `304` can't pin an HTML-less or older-rendering result after newer HTML
    // lands. Purely a key change: it only fragments the cache, and the body a
    // miss produces reflects the current DB state.
    let generations = await searchCache!.realmGenerations(realms);
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
        emitTimeline();
        return;
      }
    }
    let body = await searchCache!.getOrPopulate({
      jobId: jobId!,
      realms,
      query,
      opts: keyOpts,
      populate: runSearch,
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
    emitTimeline();
    return;
  }

  let body = await runSearch();
  await setContextResponse(
    ctxt,
    new Response(body, {
      headers: { 'content-type': SupportedMimeType.CardJson },
    }),
  );
  emitTimeline();
}
