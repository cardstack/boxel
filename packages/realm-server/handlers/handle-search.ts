import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  SupportedMimeType,
  parseSearchRequestFromPayload,
  parseSearchRequestFromRequest,
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

export default function handleSearch(): (ctxt: Koa.Context) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    let { realmList, realmByURL } = getMultiRealmAuthorization(ctxt);

    let searchRequest;
    let request = await fetchRequestFromContext(ctxt);
    try {
      let payload = getSearchRequestPayload(ctxt);
      searchRequest =
        payload !== undefined
          ? parseSearchRequestFromPayload(payload)
          : await parseSearchRequestFromRequest(request);
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

    let combined = await searchRealms(
      realmList.map((realmURL) => realmByURL.get(realmURL)),
      searchRequest.query,
      { include: searchRequest.include },
    );

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(combined, null, 2), {
        headers: { 'content-type': SupportedMimeType.CardJson },
      }),
    );
  };
}
