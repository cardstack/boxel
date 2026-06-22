import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  DURING_PRERENDER_HEADER,
  ifNoneMatchMatches,
  SupportedMimeType,
  X_BOXEL_CONSUMING_REALM_HEADER,
  parseSearchRequestPayload,
  parseSearchQueryFromPayload,
  sanitizeConsumingRealmHeader,
  SearchRequestError,
  searchRealms,
  sanitizeLoggingCorrelationId,
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

/**
 * @deprecated Backs the legacy `/_federated-search` endpoint. Prefer the v2
 * `search-entry` handler `handleSearchV2` (`/_federated-search-v2`), which
 * returns one heterogeneous result stream — prerendered HTML or live
 * serialization. Retained as a compat layer over the shared search engine;
 * removed once every consumer is on v2.
 */
export default function handleSearch(opts: {
  reconciler: RealmRegistryReconciler;
  searchCache?: JobScopedSearchCache;
}): (ctxt: Koa.Context) => Promise<void> {
  let { reconciler, searchCache } = opts;
  return async function (ctxt: Koa.Context) {
    // Hoof-to-snout server-side timing for one search: from the moment the
    // handler is entered through to the response being assembled. Stamped
    // only when the client supplied a correlation id (prerender traffic);
    // live / external callers allocate nothing and emit no line. The
    // outermost request→response bound (incl. body read + send) is the
    // `realm:requests` middleware's `dur=`, keyed by the same id.
    let handlerStart = Date.now();
    let loggingCorrelationId = sanitizeLoggingCorrelationId(
      ctxt.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
    );
    let timings =
      loggingCorrelationId !== null ? new RequestTimings() : undefined;

    let { realmList } = getMultiRealmAuthorization(ctxt);

    // Parse the plain search query — filter / sort / page (+ realms, already
    // consumed by the authorization middleware). Any other member is an
    // unknown field and rejected.
    let cardsQuery: Query;
    let request = await fetchRequestFromContext(ctxt);
    try {
      let parseRequest = async () => {
        let payload = getSearchRequestPayload(ctxt);
        if (payload === undefined) {
          payload = await parseSearchRequestPayload(request);
        }
        if (payload && typeof payload === 'object' && 'realms' in payload) {
          let { realms: _realms, ...rest } = payload as Record<string, unknown>;
          payload = rest;
        }
        return parseSearchQueryFromPayload(payload);
      };
      cardsQuery = timings
        ? await timings.time('parse', parseRequest)
        : await parseRequest();
    } catch (e) {
      if (e instanceof SearchRequestError) {
        // `invalid-query` is a client request-shape error → the JSON:API
        // search-error body; anything else (bad method / JSON) → a plain bad
        // request, the same split as the live parser used.
        if (e.code === 'invalid-query') {
          await setContextResponse(ctxt, buildSearchErrorResponse(e.message));
        } else {
          await sendResponseForBadRequest(ctxt, e.message);
        }
        return;
      }
      throw e;
    }

    let cacheOnlyDefinitions = ctxt.get(DURING_PRERENDER_HEADER).length > 0;
    // Inside a prerender the search skips the `loadLinks`
    // relationship-assembly pass entirely: the host re-resolves every
    // result card from its raw card+source file and reads only
    // `data[].id`, so the query-field `relationships.{field}.data`
    // umbrellas and the transitive `included[]` are throwaway work
    // here. The response still carries each result's pristine row (id +
    // attributes + static-link relationships) and page meta — just no
    // umbrellas and no `included[]`. Same gating as `cacheOnlyDefinitions`.
    let omitIncluded = cacheOnlyDefinitions;
    // The host's `_federated-search` fetch wrapper stamps
    // `x-boxel-job-priority` while rendering inside a prerender tab.
    // Threading it into search opts here lets `CachingDefinitionLookup`
    // sub-prerenders (fired when a `type:` filter misses the modules
    // cache) inherit the originating job's priority instead of silently
    // dropping to 0. User / API callers don't stamp the header, so the
    // value is `null` for live traffic — falls back to priority 0
    // (system-initiated default), same observable behavior as today.
    let jobPriority = sanitizeJobPriorityHeader(
      ctxt.get(PRERENDER_JOB_PRIORITY_HEADER),
    );
    // `<jobId>.<reservationId>` identity stamped by indexer-driven prerender
    // requests; used below as the job-scoped search cache's job key (the
    // whole-doc `_federated-search` response cache). Absent for live /
    // external callers, which therefore bypass the cache.
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
    let normalizedSearchOpts =
      Object.keys(searchOpts).length > 0 ? searchOpts : undefined;
    // The job-scoped cache inner key folds the live search opts; the
    // prerendered handler keys on its own `htmlFormat` / `cardUrls` /
    // `renderType` and the v2 handler on its fieldset + htmlQuery, so the
    // endpoints can't collide on a shared key.
    let cacheKeyOpts: Record<string, unknown> = { ...searchOpts };
    // `loggingCorrelationId` / `timings` are deliberately kept OUT of the
    // cache-key opts (per-request values would make every key unique and
    // defeat the cache) and ride the run-time opts instead, where
    // `searchRealms` stamps the SQL + loadLinks stages onto the collector
    // this handler emits.
    let runSearchOpts =
      loggingCorrelationId !== null
        ? {
            ...(normalizedSearchOpts ?? {}),
            ...(loggingCorrelationId !== null ? { loggingCorrelationId } : {}),
            ...(timings ? { timings } : {}),
          }
        : normalizedSearchOpts;
    // `consumingRealm` is read unconditionally — even when the
    // job-scoped search cache is disabled, `resolveRealmsForFederatedRequest`
    // uses it to scope CS-11259's self-mount fast-path. The cache gate
    // below ANDs it with `searchCache && jobId` to decide cacheability.
    let consumingRealm = sanitizeConsumingRealmHeader(
      ctxt.get(X_BOXEL_CONSUMING_REALM_HEADER),
    );
    // Lazy-mount inside runSearch so cache hits (304 / cached body)
    // skip the lazy-mount work entirely.
    let runSearch = async () => {
      let resolveRealms = () =>
        resolveRealmsForFederatedRequest(reconciler, realmList, {
          consumingRealm,
        });
      let realmInstances = timings
        ? await timings.time('resolveRealms', resolveRealms)
        : await resolveRealms();
      // `searchRealms` stamps `sql` / `loadLinks` / `populate` / cache stages
      // onto `runSearchOpts.timings`; because the handler passed a collector
      // it won't emit its own line — this handler emits the complete one.
      let doc = await searchRealms(realmInstances, cardsQuery, runSearchOpts);
      let stringify = async () => JSON.stringify(doc, null, 2);
      return timings ? await timings.time('stringify', stringify) : stringify();
    };

    // Emit the complete request→response stage breakdown. Called on every
    // terminal path that produced a response (skipped only on the parse-
    // error early returns above, which never reach here). No-op without a
    // correlation id.
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

    // Job-scoped cache + ETag/304 protocol, shared with the prerendered
    // handler (see `respondWithJobScopedSearchCache`). `jobId` is the
    // prerender job key, present only on indexer-driven prerender requests;
    // gating it behind a configured `searchCache` and ANDing with
    // `consumingRealm` inside the helper means live user / API callers always
    // see fresh data. `cacheKeyOpts` is the inner-key opts (live opts + the
    // unified render members), so the two endpoints can't collide.
    let jobId = searchCache ? prerenderJobId : null;
    await respondWithJobScopedSearchCache(ctxt, {
      searchCache,
      jobId,
      consumingRealm,
      realms: realmList,
      query: cardsQuery,
      opts: cacheKeyOpts,
      runSearch,
      emitTimeline,
    });
  };
}

// The job-scoped cache + ETag/304 protocol shared by both federated search
// handlers (`_federated-search` and `_federated-search-prerendered`). Caching
// is gated on:
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
export async function respondWithJobScopedSearchCache(
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
  let { searchCache, jobId, consumingRealm, realms, query, opts, runSearch } =
    args;
  let emitTimeline = args.emitTimeline ?? (() => {});
  let cacheable = searchCache && jobId && consumingRealm;

  if (cacheable) {
    let expectedEtag = searchCache!.computeETag({
      jobId: jobId!,
      realms,
      query,
      opts,
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
        opts,
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
      opts,
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
