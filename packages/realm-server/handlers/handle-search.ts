import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  DURING_PRERENDER_HEADER,
  ifNoneMatchMatches,
  SupportedMimeType,
  X_BOXEL_CONSUMING_REALM_HEADER,
  parseSearchQueryFromPayload,
  parseSearchQueryFromRequest,
  sanitizeConsumingRealmHeader,
  SearchRequestError,
  searchRealms,
  sanitizeLoggingCorrelationId,
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
  RequestTimings,
  emitSearchTiming,
} from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware';
import {
  getMultiRealmAuthorization,
  getSearchRequestPayload,
} from '../middleware/multi-realm-authorization';
import { resolveRealmsForFederatedRequest } from '../lib/realm-routing';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler';
import type { JobScopedSearchCache } from '../job-scoped-search-cache';
import {
  PRERENDER_JOB_ID_HEADER,
  PRERENDER_JOB_PRIORITY_HEADER,
  sanitizeJobPriorityHeader,
  sanitizePrerenderJobId,
} from '../prerender/prerender-constants';

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

    let cardsQuery;
    let request = await fetchRequestFromContext(ctxt);
    try {
      let payload = getSearchRequestPayload(ctxt);
      let parseQuery = async () =>
        payload !== undefined
          ? parseSearchQueryFromPayload(payload)
          : await parseSearchQueryFromRequest(request);
      cardsQuery = timings
        ? await timings.time('parse', parseQuery)
        : await parseQuery();
    } catch (e) {
      if (e instanceof SearchRequestError) {
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
    // `loggingCorrelationId` / `timings` are deliberately kept OUT of `searchOpts`:
    // that object is the job-scoped search cache's key material (see
    // `computeETag` / `getOrPopulate` below), and per-request values would
    // make every key unique and defeat the cache. They only need to reach
    // `searchRealms` (which stamps the SQL + loadLinks stages onto the same
    // collector this handler emits), so they ride on the run-time opts and
    // never touch the cache key.
    let runSearchOpts =
      loggingCorrelationId !== null
        ? {
            ...(normalizedSearchOpts ?? {}),
            loggingCorrelationId,
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

    // Job-scoped cache. Gated on:
    //   (a) `x-boxel-job-id` is present and well-formed (only the
    //       indexer worker stamps this; live user / API callers never
    //       carry it and therefore always see fresh data),
    //   (b) `x-boxel-consuming-realm` is present and well-formed (the
    //       host's render route only sets it during prerender).
    //
    // Cross-realm reads participate too. The contract is "one
    // consolidated view of the realm-server's state per indexing
    // batch": within a single jobId we pin search results to the
    // first observation, even if a peer realm swaps its `boxel_index`
    // mid-batch. A batch producing one consistent snapshot is more
    // valuable than chasing post-swap state across repeated reads of
    // the same query. Same-process writes (this batch's own swap)
    // still trip `Realm.update`'s onInvalidation → clearInFlightSearch
    // (Phase 1 path), so the cache only freezes *peer-realm* swaps
    // within the job's lifetime.
    //
    // `multiRealmAuthorization` has already validated read access to
    // every entry of `realmList` for this caller, so the cache cannot
    // surface results across an authorization boundary.
    let jobId = searchCache ? prerenderJobId : null;
    let cacheable = searchCache && jobId && consumingRealm;

    if (cacheable) {
      // ETag is opaque-but-deterministic over (jobId, innerKey).
      // Same `(jobId, realms, query, opts)` always yields the same
      // value for an entry's lifetime; a different jobId yields a
      // different value so a stale If-None-Match from a previous
      // batch never matches a fresh entry. Only emitted to / honored
      // from cacheable callers — non-indexer traffic bypasses the
      // cache and ETag protocol entirely, same gate as today.
      let expectedEtag = searchCache!.computeETag({
        jobId: jobId!,
        realms: realmList,
        query: cardsQuery,
        opts: searchOpts,
      });
      let ifNoneMatch = ctxt.get('If-None-Match');
      if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, expectedEtag)) {
        // Only honor 304 when the cache still has the body — a
        // TTL-evicted slot whose ETag the caller happens to remember
        // must fall through and re-populate, otherwise a follow-up
        // request would find nothing to revalidate against.
        let cached = await searchCache!.getCached({
          jobId: jobId!,
          realms: realmList,
          query: cardsQuery,
          opts: searchOpts,
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
        realms: realmList,
        query: cardsQuery,
        opts: searchOpts,
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
  };
}
