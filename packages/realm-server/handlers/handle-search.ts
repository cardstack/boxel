import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  DURING_PRERENDER_HEADER,
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
import type { JobScopedSearchCache } from '../job-scoped-search-cache';
import {
  PRERENDER_JOB_ID_HEADER,
  PRERENDER_JOB_PRIORITY_HEADER,
  sanitizeJobPriorityHeader,
  sanitizePrerenderJobId,
} from '../prerender/prerender-constants';

export default function handleSearch(opts?: {
  searchCache?: JobScopedSearchCache;
}): (ctxt: Koa.Context) => Promise<void> {
  let searchCache = opts?.searchCache;
  return async function (ctxt: Koa.Context) {
    let { realmList, realmByURL } = getMultiRealmAuthorization(ctxt);

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
    let runSearch = async () =>
      JSON.stringify(
        await searchRealms(
          realmList.map((realmURL) => realmByURL.get(realmURL)),
          cardsQuery,
          normalizedSearchOpts,
        ),
        null,
        2,
      );

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
    let consumingRealm = searchCache
      ? sanitizeConsumingRealmHeader(ctxt.get(X_BOXEL_CONSUMING_REALM_HEADER))
      : null;
    let cacheable = searchCache && jobId && consumingRealm;

    let body = cacheable
      ? await searchCache!.getOrPopulate({
          jobId: jobId!,
          realms: realmList,
          query: cardsQuery,
          opts: searchOpts,
          populate: runSearch,
        })
      : await runSearch();

    await setContextResponse(
      ctxt,
      new Response(body, {
        headers: { 'content-type': SupportedMimeType.CardJson },
      }),
    );
  };
}
