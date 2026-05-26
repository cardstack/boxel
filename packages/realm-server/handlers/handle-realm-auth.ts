import type Koa from 'koa';

import type { CreateRoutesArgs } from '../routes';
import {
  fetchSessionRoom,
  fetchUserPermissions,
  param,
  query,
  separatedByCommas,
  SupportedMimeType,
  upsertSessionRoom,
  type Expression,
} from '@cardstack/runtime-common';
import type { RealmServerTokenClaim } from 'utils/jwt';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import { createJWT } from '../jwt';
import { sendResponseForError, setContextResponse } from '../middleware';
import * as Sentry from '@sentry/node';

export default function handleRealmAuth({
  dbAdapter,
  matrixClient,
  realmSecretSeed,
  reconciler,
  serverURL,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    let { user: matrixUserId } = token;
    let user = await getUserByMatrixUserId(dbAdapter, matrixUserId);

    if (!user) {
      await sendResponseForError(
        ctxt,
        422,
        'Unprocessable Entity',
        'User in JWT not found',
      );
      return;
    }

    let permissionsForAllRealms = await fetchUserPermissions(dbAdapter, {
      userId: matrixUserId,
      onlyOwnRealms: false,
    });
    let accessibleRealmUrls = Object.keys(permissionsForAllRealms);

    // Validate each accessible realm URL against the registry WITHOUT
    // mounting it. fetchUserPermissions with onlyOwnRealms:false returns
    // every '*'-readable realm in addition to the user's own; routing
    // each row through reconciler.lookupOrMount would cold-mount every
    // public-readable realm on the server on the first post-restart
    // _realm-auth call (boxel realm list, host login). Phase 3's lazy-
    // mount contract is "mount on first per-realm request" — the per-
    // realm JWT itself is fine to issue from registry presence alone;
    // the mount happens later, when the holder actually hits a realm
    // endpoint and findOrMountRealm/lookupOrMount runs there.
    //
    // Same lookup order as multiRealmAuthorization (CS-11238): in-memory
    // reconciler.knownByUrl first, then a single batched probe against
    // realm_registry for any URLs not yet reflected in this process
    // (e.g. a freshly-published row from a peer instance between NOTIFY
    // and the next reconcile pass).
    let registeredUrls = new Set<string>();
    let urlsToProbe: string[] = [];
    for (let realmUrl of accessibleRealmUrls) {
      if (reconciler.knownByUrl.has(realmUrl)) {
        registeredUrls.add(realmUrl);
      } else {
        urlsToProbe.push(realmUrl);
      }
    }
    if (urlsToProbe.length > 0) {
      let rows = (await query(dbAdapter, [
        'SELECT url FROM realm_registry WHERE url IN (',
        ...separatedByCommas(urlsToProbe.map((url) => [param(url)])),
        ')',
      ] as Expression)) as { url: string }[];
      for (let { url } of rows) {
        registeredUrls.add(url);
      }
    }

    // Resolve the user's session room ONCE per request. The session room
    // is keyed by matrixUserId in the DB, not by realm, so calling
    // realm.ensureSessionRoom() per accessible realm (as this handler
    // used to) was N redundant DB reads on the fast path and forced us
    // to materialize each realm as a `Realm` instance on the cold path.
    // For the create branch we use the realm-server's matrix client,
    // matching how _server-session creates session rooms — at this
    // point in the request lifecycle the caller has already exchanged
    // an OpenID token via _server-session, so the server client is
    // already logged in. login() is idempotent (cached promise).
    let sessionRoom: string | null = await fetchSessionRoom(
      dbAdapter,
      matrixUserId,
    );
    if (!sessionRoom) {
      try {
        await matrixClient.login();
        sessionRoom = await matrixClient.createDM(matrixUserId);
        await upsertSessionRoom(dbAdapter, matrixUserId, sessionRoom);
      } catch (error) {
        Sentry.withScope((scope) => {
          scope.setExtra('matrixUserId', matrixUserId);
          Sentry.captureException(error);
        });
        await sendResponseForError(
          ctxt,
          500,
          'Internal Server Error',
          'Failed to ensure session room',
        );
        return;
      }
    }

    let sessions: { [realm: string]: string } = {};
    for (let realmUrl of accessibleRealmUrls) {
      if (!registeredUrls.has(realmUrl)) {
        console.error(
          `Permissions found pointing to unknown realm ${realmUrl}`,
        );
        continue;
      }
      let permissions = permissionsForAllRealms[realmUrl];
      try {
        sessions[realmUrl] = createJWT(
          {
            user: matrixUserId,
            realm: realmUrl,
            permissions,
            sessionRoom,
            realmServerURL: serverURL,
          },
          '7d',
          realmSecretSeed,
        );
      } catch (error) {
        Sentry.withScope((scope) => {
          scope.setExtra('realmUrl', realmUrl);
          scope.setExtra('matrixUserId', matrixUserId);
          scope.setExtra('permissionsForAllRealms', permissionsForAllRealms);
          Sentry.captureException(error);
        });
        continue;
      }
    }

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(sessions, null, 2), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
