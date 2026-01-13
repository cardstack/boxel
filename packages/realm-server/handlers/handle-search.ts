import type Koa from 'koa';
import { retrieveTokenClaim, type RealmServerTokenClaim } from '../utils/jwt';
import type { CreateRoutesArgs } from '../routes';
import {
  fetchUserPermissions,
  buildSearchErrorResponse,
  SupportedMimeType,
  parseRealmsParam,
  parseSearchQueryFromRequest,
  SearchRequestError,
  searchRealms,
  ensureTrailingSlash,
} from '@cardstack/runtime-common';
import { AuthenticationError } from '@cardstack/runtime-common/router';
import {
  fullRequestURL,
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForUnauthorizedRequest,
  setContextResponse,
} from '../middleware';

export default function handleSearch({
  dbAdapter,
  realmSecretSeed,
  realms,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let url = fullRequestURL(ctxt);
    let realmList = parseRealmsParam(url);

    if (realmList.length === 0) {
      await sendResponseForBadRequest(
        ctxt,
        'realms query param must be supplied',
      );
      return;
    }

    let realmByURL = new Map(realms.map((realm) => [realm.url, realm]));
    let unknownRealms = realmList.filter(
      (realmURL) => !realmByURL.has(realmURL),
    );
    if (unknownRealms.length > 0) {
      await sendResponseForNotFound(
        ctxt,
        `Realms not found: ${unknownRealms.join(', ')}`,
      );
      return;
    }

    let readableRealms = new Set<string>();
    let authorization = ctxt.req.headers['authorization'];
    if (!authorization) {
      let publicPermissions = await fetchUserPermissions(dbAdapter, {
        userId: '*',
        onlyOwnRealms: false,
      });
      readableRealms = new Set(
        Object.entries(publicPermissions)
          .filter(([, permissions]) => permissions.includes('read'))
          .map(([realmURL]) => ensureTrailingSlash(realmURL)),
      );

      let realmsRequiringAuth = realmList.filter(
        (realmURL) => !readableRealms.has(realmURL),
      );
      if (realmsRequiringAuth.length > 0) {
        await sendResponseForUnauthorizedRequest(
          ctxt,
          `Authorization required for realms: ${realmsRequiringAuth.join(', ')}`,
        );
        return;
      }
    } else {
      let token: RealmServerTokenClaim;
      try {
        token = retrieveTokenClaim(authorization, realmSecretSeed);
      } catch (e) {
        if (e instanceof AuthenticationError) {
          await sendResponseForUnauthorizedRequest(ctxt, e.message);
          return;
        }
        throw e;
      }

      let permissionsForAllRealms = await fetchUserPermissions(dbAdapter, {
        userId: token.user,
        onlyOwnRealms: false,
      });
      readableRealms = new Set(
        Object.entries(permissionsForAllRealms)
          .filter(([, permissions]) => permissions.includes('read'))
          .map(([realmURL]) => ensureTrailingSlash(realmURL)),
      );

      let unauthorizedRealms = realmList.filter(
        (realmURL) => !readableRealms.has(realmURL),
      );
      if (unauthorizedRealms.length > 0) {
        await sendResponseForForbiddenRequest(
          ctxt,
          `Insufficient permissions to read realms: ${unauthorizedRealms.join(
            ', ',
          )}`,
        );
        return;
      }
    }

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
