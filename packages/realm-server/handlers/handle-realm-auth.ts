import Koa from 'koa';

import { type CreateRoutesArgs } from '../routes';
import {
  SupportedMimeType,
  fetchUserPermissions,
} from '@cardstack/runtime-common';
import { RealmServerTokenClaim } from 'utils/jwt';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import { createJWT } from '../jwt';
import { sendResponseForError, setContextResponse } from '../middleware';
import * as Sentry from '@sentry/node';

export default function handleRealmAuth({
  dbAdapter,
  realmSecretSeed,
  realms,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let allRealms = realms;
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

    let sessions: { [realm: string]: string } = {};
    for (let [realmUrl, permissions] of Object.entries(
      permissionsForAllRealms,
    )) {
      let realm = allRealms.find((r) => r.url === realmUrl);
      if (!realm) {
        console.error(
          `Permissions found pointing to unknown realm ${realmUrl}`,
        );
        continue;
      }

      try {
        let sessionRoom = await realm.ensureSessionRoom(matrixUserId);
        sessions[realmUrl] = createJWT(
          {
            user: matrixUserId,
            realm: realmUrl,
            permissions,
            sessionRoom,
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
