import type Koa from 'koa';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  fetchUserPermissions,
  parseRealmsParam,
  ensureTrailingSlash,
} from '@cardstack/runtime-common';
import { AuthenticationError } from '@cardstack/runtime-common/router';
import { retrieveTokenClaim, type RealmServerTokenClaim } from '../utils/jwt';
import {
  fullRequestURL,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForUnauthorizedRequest,
} from '../middleware';

export type MultiRealmAuthorizationState = {
  realmList: string[];
  realmByURL: Map<string, Realm>;
};

const MULTI_REALM_AUTH_STATE = 'multiRealmAuthorization';

export function multiRealmAuthorization({
  dbAdapter,
  realmSecretSeed,
  realms,
}: {
  dbAdapter: DBAdapter;
  realmSecretSeed: string;
  realms: Realm[];
}): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, next: Koa.Next) {
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

    (ctxt.state as Record<string, unknown>)[MULTI_REALM_AUTH_STATE] = {
      realmList,
      realmByURL,
    } satisfies MultiRealmAuthorizationState;

    await next();
  };
}

export function getMultiRealmAuthorization(
  ctxt: Koa.Context,
): MultiRealmAuthorizationState {
  let state = (ctxt.state as Record<string, unknown>)[
    MULTI_REALM_AUTH_STATE
  ] as MultiRealmAuthorizationState | undefined;
  if (!state) {
    throw new Error('Multi-realm authorization state is missing');
  }
  return state;
}
