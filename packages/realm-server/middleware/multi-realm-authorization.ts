import type Koa from 'koa';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  archivedRealmURLs,
  fetchUserPermissions,
  isSessionRevoked,
  param,
  parseRealmsFromPayload,
  parseSearchRequestPayload,
  query,
  SearchRequestError,
  separatedByCommas,
  type Expression,
} from '@cardstack/runtime-common';
import {
  AuthenticationError,
  AuthenticationErrorMessages,
} from '@cardstack/runtime-common/router';
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
  // The realms this request named that the caller may read outright. These are
  // searched as they always have been, and a policy is never consulted for
  // one: a policy widens what the ACL refused and has nothing to add to what
  // it allowed.
  realmList: string[];
  // The realms this request named that the caller may not read, on an
  // endpoint that carries them rather than refusing. Each is reached only
  // through its own policy, and contributes rows only where a `query` grant
  // admits this caller — otherwise nothing. Naming one is not an error: a
  // federated search asks several realms a question, and a realm that has no
  // answer for this caller is a realm with no rows, exactly as a realm
  // holding no matching card is. Always empty on an endpoint that refuses.
  grantCandidates: string[];
  // The user the request's token was verified for. Absent on a request that
  // carried no token, which reached here only because every realm it names
  // is publicly readable.
  user?: string;
};

const MULTI_REALM_AUTH_STATE = 'multiRealmAuthorization';
const SEARCH_REQUEST_PAYLOAD_STATE = 'searchRequestPayload';

export function multiRealmAuthorization(
  {
    dbAdapter,
    realmSecretSeed,
    realms,
    reconciler,
  }: {
    dbAdapter: DBAdapter;
    realmSecretSeed: string;
    realms: Realm[];
    reconciler: RealmRegistryReconciler;
  },
  {
    unreadableRealms = 'refuse',
  }: {
    // What becomes of a realm a verified caller may not read. `refuse`
    // answers the whole request 403. `carry` passes the realm on as a grant
    // candidate, for an endpoint where a realm's policy can admit a caller its
    // ACL did not, so that each realm answers for itself rather than any one
    // of them answering for the rest.
    unreadableRealms?: 'refuse' | 'carry';
  } = {},
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
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
    let user: string | undefined;
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

      // Authentication comes before authorization, and a request that named
      // nobody is told to say who it is rather than answered for nobody. A
      // policy grants by who is asking, so there is no grant for this request
      // to be judged by either — which is why this refuses where an
      // authenticated caller without permission does not.
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
      let token: RealmServerTokenClaim & { iat: number; exp: number };
      try {
        token = retrieveTokenClaim(authorization, realmSecretSeed);
        if (await isSessionRevoked(dbAdapter, token.user, token.iat)) {
          throw new AuthenticationError(
            AuthenticationErrorMessages.SessionRevoked,
          );
        }
      } catch (e) {
        if (e instanceof AuthenticationError) {
          await sendResponseForUnauthorizedRequest(ctxt, e.message);
          return;
        }
        throw e;
      }

      user = token.user;
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
      if (unreadableRealms === 'refuse' && unauthorizedRealms.length > 0) {
        await sendResponseForForbiddenRequest(
          ctxt,
          `Insufficient permissions to read realms: ${unauthorizedRealms.join(
            ', ',
          )}`,
        );
        return;
      }
    }

    // A realm the caller may not read is carried forward rather than refused.
    // Its rows are then whatever its own policy grants this caller, which is
    // commonly none — and a realm contributing no rows does not refuse the
    // realms alongside it. A verified caller therefore never has one realm's
    // permissions decide the answer for another's.
    //
    // An archived realm is not one of them. Archiving a realm is what takes
    // every caller's permission on it away, so it is unreadable to everyone,
    // and it stays sealed whatever its policy says: nothing is served from an
    // archived realm to anyone.
    let readable = realmList.filter((realmURL) => readableRealms.has(realmURL));
    let unreadable = realmList.filter(
      (realmURL) => !readableRealms.has(realmURL),
    );
    let archived = await archivedRealmURLs(dbAdapter, unreadable);
    let grantCandidates = unreadable.filter(
      (realmURL) => !archived.has(realmURL),
    );

    (ctxt.state as Record<string, unknown>)[MULTI_REALM_AUTH_STATE] = {
      realmList: readable,
      grantCandidates,
      ...(user === undefined ? {} : { user }),
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
