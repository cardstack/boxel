import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  ifNoneMatchMatches,
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
  sanitizePrerenderJobId,
} from '../prerender/prerender-constants.ts';

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
        await searchPrerenderedRealms(
          realmInstances,
          parsed.cardsQuery,
          searchOpts,
        ),
        null,
        2,
      );
    };

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
    let cacheable = searchCache && jobId && consumingRealm;

    if (cacheable) {
      // Symmetric to `_federated-search`: emit a job-id-based ETag
      // on every cacheable response and honor If-None-Match against
      // the same expected value. Inner-key canonicalisation already
      // segregates this endpoint's entries from `_federated-search`
      // via the `htmlFormat` / `cardUrls` / `renderType` keys folded
      // into `opts`, so the two endpoints' ETags cannot collide on
      // a key they don't both fully share.
      let expectedEtag = searchCache!.computeETag({
        jobId: jobId!,
        realms: realmList,
        query: parsed.cardsQuery,
        opts: searchOpts,
      });
      let ifNoneMatch = ctxt.get('If-None-Match');
      if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, expectedEtag)) {
        let cached = await searchCache!.getCached({
          jobId: jobId!,
          realms: realmList,
          query: parsed.cardsQuery,
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
        query: parsed.cardsQuery,
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
