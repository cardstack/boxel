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

export default function handleRealmAuth({
  dbAdapter,
  realmSecretSeed,
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

    let permissionsForAllRealms = await fetchUserPermissions(
      dbAdapter,
      matrixUserId,
    );
    let sessions: { [realm: string]: string } = {};
    for (let [realm, permissions] of Object.entries(permissionsForAllRealms)) {
      sessions[realm] = createJWT(
        {
          user: user.id,
          realm: realm,
          permissions,
          sessionRoom: '',
        },
        '7d',
        realmSecretSeed,
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
