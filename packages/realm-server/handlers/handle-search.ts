import type Koa from 'koa';
import {
  buildSearchErrorResponse,
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

    let runSearch = () =>
      searchRealms(
        realmList.map((realmURL) => realmByURL.get(realmURL)),
        cardsQuery,
      );

    // Job-scoped same-realm cache. Gated on all three:
    //   (a) `x-boxel-job-id` is present and well-formed (only the
    //       indexer worker stamps this; live user / API callers never
    //       carry it and therefore always see fresh data),
    //   (b) `x-boxel-consuming-realm` is present and well-formed (the
    //       host's render route only sets it during prerender),
    //   (c) the request's `realms` list is exactly `[consumingRealm]`
    //       — cross-realm reads bypass the cache because a peer
    //       realm can swap its `boxel_index` mid-batch and the cached
    //       value would freeze a stale snapshot.
    let jobId = searchCache
      ? sanitizePrerenderJobId(ctxt.get(PRERENDER_JOB_ID_HEADER))
      : null;
    let consumingRealm = searchCache
      ? sanitizeConsumingRealmHeader(ctxt.get(X_BOXEL_CONSUMING_REALM_HEADER))
      : null;
    let cacheable =
      searchCache &&
      jobId &&
      consumingRealm &&
      realmList.length === 1 &&
      realmList[0] === consumingRealm;

    let combined = cacheable
      ? await searchCache!.getOrPopulate({
          jobId: jobId!,
          query: cardsQuery,
          opts: undefined,
          populate: runSearch,
        })
      : await runSearch();

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(combined, null, 2), {
        headers: { 'content-type': SupportedMimeType.CardJson },
      }),
    );
  };
}
