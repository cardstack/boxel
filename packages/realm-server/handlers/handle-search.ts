import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  SupportedMimeType,
  logger,
  parseSearchQueryFromPayload,
  parseSearchQueryFromRequest,
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

const searchLog = logger('realm-server:federated-search');

export default function handleSearch(): (ctxt: Koa.Context) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    let totalStart = Date.now();
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

    let searchStart = Date.now();
    let combined = await searchRealms(
      realmList.map((realmURL) => realmByURL.get(realmURL)),
      cardsQuery,
    );
    let searchMs = Date.now() - searchStart;
    let totalMs = Date.now() - totalStart;

    // 1s threshold so normal in-cache fetches don't spam logs but the
    // 90s renders that block prerender tabs are unmissable. The per-
    // realm phase breakdown (primaryQuery / loadLinks / attachRealmInfo)
    // is emitted by realm-index-query-engine; this line correlates the
    // HTTP-level total with that breakdown via realm-list membership.
    if (totalMs >= 1000) {
      let resultCount = combined.data?.length ?? 0;
      let includedCount = combined.included?.length ?? 0;
      searchLog.info(
        `slow /_federated-search total=${totalMs}ms searchRealms=${searchMs}ms ` +
          `realmCount=${realmList.length} realms=${realmList.slice(0, 4).join(',')}` +
          `${realmList.length > 4 ? `+${realmList.length - 4}` : ''} ` +
          `data=${resultCount} included=${includedCount}`,
      );
    }

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(combined, null, 2), {
        headers: { 'content-type': SupportedMimeType.CardJson },
      }),
    );
  };
}
