import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  SupportedMimeType,
  X_BOXEL_CONSUMING_REALM_HEADER,
  parsePrerenderedSearchRequestFromPayload,
  parsePrerenderedSearchRequestFromRequest,
  sanitizeConsumingRealmHeader,
  SearchRequestError,
  searchPrerenderedRealms,
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

export default function handleSearchPrerendered(opts?: {
  searchCache?: JobScopedSearchCache;
}): (ctxt: Koa.Context) => Promise<void> {
  let searchCache = opts?.searchCache;
  return async function (ctxt: Koa.Context) {
    let { realmList, realmByURL } = getMultiRealmAuthorization(ctxt);

    let request = await fetchRequestFromContext(ctxt);
    let parsed;
    try {
      let payload = getSearchRequestPayload(ctxt);
      parsed =
        payload !== undefined
          ? parsePrerenderedSearchRequestFromPayload(payload)
          : await parsePrerenderedSearchRequestFromRequest(request);
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

    let searchOpts = {
      htmlFormat: parsed.htmlFormat,
      cardUrls: parsed.cardUrls,
      renderType: parsed.renderType,
    };
    let runSearch = async () =>
      JSON.stringify(
        await searchPrerenderedRealms(
          realmList.map((realmURL) => realmByURL.get(realmURL)),
          parsed.cardsQuery,
          searchOpts,
        ),
        null,
        2,
      );

    // Symmetric to `_federated-search`'s gating. Cache is consulted
    // only when both indexer-traffic headers are present and well-
    // formed:
    //   (a) `x-boxel-job-id` — only the indexer worker stamps this,
    //   (b) `x-boxel-consuming-realm` — the host's render route only
    //       sets it during prerender.
    // User-facing API callers never carry both, so they always
    // bypass the cache and observe live SQL state.
    //
    // The prerendered handler's request shape carries
    // `htmlFormat` / `cardUrls` / `renderType` which materially
    // change the response body. These are passed through `opts` so
    // the cache's `sortKeysDeep`-canonicalised inner key segregates
    // entries that differ on any of them. `cardsQuery` is whatever
    // remains after those three keys are stripped by
    // `parsePrerenderedSearchRequest…` — so the cache key reflects
    // the full request shape, not just the query body.
    //
    // `multiRealmAuthorization` has already validated read access
    // for every entry of `realmList`, so the cache cannot surface
    // results across an authorization boundary.
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
          query: parsed.cardsQuery,
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
