import type Koa from 'koa';
import {
  buildSearchErrorResponse,
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
import { resolveRealmsForFederatedRequest } from '../lib/realm-routing';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler';
import type { JobScopedSearchCache } from '../job-scoped-search-cache';
import {
  PRERENDER_JOB_ID_HEADER,
  sanitizePrerenderJobId,
} from '../prerender/prerender-constants';
import { respondWithJobScopedSearchCache } from './handle-search';

// The legacy prerendered federated endpoint. It parses its own request shape
// (`prerenderedHtmlFormat` / `cardUrls` / `renderType`) and still emits today's
// prerendered-card document, but shares the job-scoped cache + ETag/304
// protocol with `_federated-search` through `respondWithJobScopedSearchCache`.
// Its `htmlFormat` / `cardUrls` / `renderType` opts are the inner-key opts, so
// its cache entries segregate from the live endpoint's. Retired once the
// unified document subsumes it.
export default function handleSearchPrerendered(opts: {
  reconciler: RealmRegistryReconciler;
  searchCache?: JobScopedSearchCache;
}): (ctxt: Koa.Context) => Promise<void> {
  let { reconciler, searchCache } = opts;
  return async function (ctxt: Koa.Context) {
    let { realmList } = getMultiRealmAuthorization(ctxt);

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
    // `consumingRealm` is read unconditionally — even when the cache is
    // disabled, `resolveRealmsForFederatedRequest` uses it to scope the
    // self-mount fast-path. The cache gate ANDs it with `searchCache && jobId`.
    let consumingRealm = sanitizeConsumingRealmHeader(
      ctxt.get(X_BOXEL_CONSUMING_REALM_HEADER),
    );
    // Lazy-mount inside runSearch so cache hits (304 / cached body) skip the
    // lazy-mount work entirely.
    let runSearch = async () => {
      let realmInstances = await resolveRealmsForFederatedRequest(
        reconciler,
        realmList,
        { consumingRealm },
      );
      return JSON.stringify(
        await searchPrerenderedRealms(
          realmInstances,
          parsed.cardsQuery,
          searchOpts,
        ),
        null,
        2,
      );
    };

    let jobId = searchCache
      ? sanitizePrerenderJobId(ctxt.get(PRERENDER_JOB_ID_HEADER))
      : null;
    await respondWithJobScopedSearchCache(ctxt, {
      searchCache,
      jobId,
      consumingRealm,
      realms: realmList,
      query: parsed.cardsQuery,
      opts: searchOpts,
      runSearch,
    });
  };
}
