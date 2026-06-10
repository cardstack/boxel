import type Koa from 'koa';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  fetchUserPermissions,
  param,
  parseRealmsFromPayload,
  parseSearchRequestPayload,
  query,
  SearchRequestError,
  separatedByCommas,
  type Expression,
} from '@cardstack/runtime-common';
import { AuthenticationError } from '@cardstack/runtime-common/router';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler.ts';
import {
  retrieveTokenClaim,
  type RealmServerTokenClaim,
} from '../utils/jwt.ts';
import {
  buildReadableRealms,
  getPublishedRealmURLs,
} from '../utils/realm-readability.ts';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForUnauthorizedRequest,
} from '../middleware/index.ts';

export type MultiRealmAuthorizationState = {
  realmList: string[];
};

const MULTI_REALM_AUTH_STATE = 'multiRealmAuthorization';
const SEARCH_REQUEST_PAYLOAD_STATE = 'searchRequestPayload';

export function multiRealmAuthorization({
  dbAdapter,
  realmSecretSeed,
  realms,
  reconciler,
}: {
  dbAdapter: DBAdapter;
  realmSecretSeed: string;
  realms: Realm[];
  reconciler: RealmRegistryReconciler;
}): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, next: Koa.Next) {
    let request = await fetchRequestFromContext(ctxt);
    let realmList: string[];
    try {
      let payload = await parseSearchRequestPayload(request);
      realmList = parseRealmsFromPayload(payload);
      (ctxt.state as Record<string, unknown>)[SEARCH_REQUEST_PAYLOAD_STATE] =
        payload;
    } catch (e: any) {
      if (e instanceof SearchRequestError) {
        await sendResponseForBadRequest(ctxt, e.message);
        return;
      }
      throw e;
    }

    // Registry-presence check (CS-11238). Phase 3 lazy-mounts source
    // realms on first per-realm request via findOrMountRealm; a
    // federated request for a realm that hasn't been touched yet in
    // this process's lifetime must not 404 just because realms[]
    // hasn't observed it. The middleware confirms the URL is a known
    // registry row but does NOT force a mount — handlers mount
    // lazily per-realm via reconciler.lookupOrMount() as they need a
    // Realm reference, avoiding N simultaneous realm.start() calls
    // on a cold first federated search.
    //
    // Mirrors findOrMountRealm's lookup order for the exact-URL case:
    //   1. realms[] — covers mounted realms including the mid-start
    //      window. Federated payloads carry exact realm URLs so we
    //      don't need findOrMountRealm's prefix walk.
    //   2. reconciler.knownByUrl — the reconciler's in-memory
    //      reflection of realm_registry, refreshed on boot,
    //      NOTIFY, and the safety-net poll.
    //   3. direct realm_registry probe — covers the gap between a
    //      peer instance's INSERT + NOTIFY and this instance's next
    //      reconcile pass.
    let mountedUrls = new Set(realms.map((r) => r.url));
    let urlsToProbe: string[] = [];
    for (let realmURL of realmList) {
      if (mountedUrls.has(realmURL)) continue;
      if (reconciler.knownByUrl.has(realmURL)) continue;
      urlsToProbe.push(realmURL);
    }
    let unknownRealms: string[] = [];
    if (urlsToProbe.length > 0) {
      let rows = (await query(dbAdapter, [
        'SELECT url FROM realm_registry WHERE url IN (',
        ...separatedByCommas(urlsToProbe.map((url) => [param(url)])),
        ')',
      ] as Expression)) as { url: string }[];
      let foundInDb = new Set(rows.map((r) => r.url));
      for (let realmURL of urlsToProbe) {
        if (!foundInDb.has(realmURL)) {
          unknownRealms.push(realmURL);
        }
      }
    }
    if (unknownRealms.length > 0) {
      await sendResponseForNotFound(
        ctxt,
        `Realms not found: ${unknownRealms.join(', ')}`,
      );
      return;
    }

    let publishedRealmURLs = await getPublishedRealmURLs(dbAdapter, realmList);

    let readableRealms = new Set<string>();
    let authorization = ctxt.req.headers['authorization'];
    if (!authorization) {
      let publicPermissions = await fetchUserPermissions(dbAdapter, {
        userId: '*',
        onlyOwnRealms: false,
      });
      readableRealms = buildReadableRealms(
        publicPermissions,
        publishedRealmURLs,
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
      readableRealms = buildReadableRealms(
        permissionsForAllRealms,
        publishedRealmURLs,
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

export function getSearchRequestPayload(
  ctxt: Koa.Context,
): unknown | undefined {
  return (ctxt.state as Record<string, unknown>)[SEARCH_REQUEST_PAYLOAD_STATE];
}
