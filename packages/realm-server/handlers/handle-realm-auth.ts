import Koa from 'koa';

import { type CreateRoutesArgs } from '../routes';
import {
  SupportedMimeType,
  fetchUserPermissions,
  getSessionRoom,
  REALM_SERVER_REALM,
  logger,
} from '@cardstack/runtime-common';
import { RealmServerTokenClaim } from 'utils/jwt';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import { createJWT } from '../jwt';
import { sendResponseForError, setContextResponse } from '../middleware';

const log = logger('realm-server');

export default function handleRealmAuth({
  dbAdapter,
  realmSecretSeed,
  realms,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let realmsByURL = new Map(realms.map((realm) => [realm.url, realm]));

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

    let realmServerSessionRoomId = await getSessionRoom(
      dbAdapter,
      REALM_SERVER_REALM,
      user.matrixUserId,
    );

    if (!realmServerSessionRoomId) {
      await sendResponseForError(
        ctxt,
        422,
        'Unprocessable Entity',
        'Session room not found for user',
      );
      return;
    }

    let permissionsForAllRealms = await fetchUserPermissions(dbAdapter, {
      userId: matrixUserId,
      onlyOwnRealms: false,
    });

    let sessions: { [realm: string]: string } = {};
    let fallbackRealms: string[] = [];
    for (let [realm, permissions] of Object.entries(permissionsForAllRealms)) {
      let sessionRoomId = await getSessionRoom(
        dbAdapter,
        realm,
        user.matrixUserId,
      );

      if (!sessionRoomId) {
        let realmInstance = realmsByURL.get(realm);
        if (!realmInstance) {
          log.warn(
            `Realm ${realm} is not currently loaded; using realm-server DM room for user ${matrixUserId}`,
          );
          fallbackRealms.push(realm);
          sessionRoomId = realmServerSessionRoomId;
        } else {
          try {
            sessionRoomId = await realmInstance.ensureSessionRoom(
              user.matrixUserId,
            );
          } catch (error) {
            log.error(
              `Unable to ensure session room for user ${matrixUserId} in realm ${realm}, falling back to realm-server DM room`,
              error,
            );
            fallbackRealms.push(realm);
            sessionRoomId = realmServerSessionRoomId;
          }
        }
      } else {
        let realmInstance = realmsByURL.get(realm);
        if (!realmInstance) {
          log.warn(
            `Realm ${realm} is not currently loaded but session room ${sessionRoomId} exists; using existing room for user ${matrixUserId}`,
          );
        }
      }

      sessions[realm] = createJWT(
        {
          user: matrixUserId,
          realm: realm,
          permissions,
          sessionRoom: sessionRoomId,
        },
        '7d',
        realmSecretSeed,
      );
    }

    if (fallbackRealms.length > 0) {
      log.warn(
        `Used realm-server session room for user ${matrixUserId} in realm(s): ${fallbackRealms.join(', ')}`,
      );
    }

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(sessions, null, 2), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
