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
    let { realmList } = getMultiRealmAuthorization(ctxt);

    let cardsQuery;
    let request = await fetchRequestFromContext(ctxt);
    try {
      let payload = getSearchRequestPayload(ctxt);
      cardsQuery =
        payload !== undefined
          ? parseSearchQueryFromPayload(payload)
          : await parseSearchQueryFromRequest(request);
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
    let searchOpts: { cacheOnlyDefinitions?: true; priority?: number } = {};
    if (cacheOnlyDefinitions) searchOpts.cacheOnlyDefinitions = true;
    if (jobPriority !== null) searchOpts.priority = jobPriority;
    let normalizedSearchOpts =
      Object.keys(searchOpts).length > 0 ? searchOpts : undefined;
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
      let realmInstances = await resolveRealmsForFederatedRequest(
        reconciler,
        realmList,
        { consumingRealm },
      );
      return JSON.stringify(
        await searchRealms(realmInstances, cardsQuery, normalizedSearchOpts),
        null,
        2,
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
    let jobId = searchCache
      ? sanitizePrerenderJobId(ctxt.get(PRERENDER_JOB_ID_HEADER))
      : null;
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
        let cached = searchCache!.peek({
          jobId: jobId!,
          realms: realmList,
          query: cardsQuery,
          opts: searchOpts,
        });
        if (cached !== undefined) {
          ctxt.status = 304;
          ctxt.set('ETag', expectedEtag);
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
      return;
    }

    let body = await runSearch();
    await setContextResponse(
      ctxt,
      new Response(body, {
        headers: { 'content-type': SupportedMimeType.CardJson },
      }),
    );
  };
}
