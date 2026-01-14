import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  SupportedMimeType,
  parseSearchQueryFromRequest,
  SearchRequestError,
  searchRealms,
} from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware';
import { getMultiRealmAuthorization } from '../middleware/multi-realm-authorization';

export default function handleSearch(): (ctxt: Koa.Context) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    let { realmList, realmByURL } = getMultiRealmAuthorization(ctxt);

    let cardsQuery;
    let request = await fetchRequestFromContext(ctxt);
    try {
      cardsQuery = await parseSearchQueryFromRequest(request);
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
      cardsQuery,
    );

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(combined, null, 2), {
        headers: { 'content-type': SupportedMimeType.CardJson },
      }),
    );
  };
}
