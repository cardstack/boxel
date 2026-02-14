import {
  fetchSessionRoom,
  logger,
  SupportedMimeType,
  upsertSessionRoom,
} from '@cardstack/runtime-common';
import type { Utils } from '@cardstack/runtime-common/matrix-backend-authentication';
import { MatrixBackendAuthentication } from '@cardstack/runtime-common/matrix-backend-authentication';
import type Koa from 'koa';
import { createJWT } from '../utils/jwt';
import {
  fetchRequestFromContext,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { CreateRoutesArgs } from '../routes';

const log = logger('realm-server');

export default function handleCreateSessionRequest({
  matrixClient,
  realmSecretSeed,
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let matrixBackendAuthentication = new MatrixBackendAuthentication(
    matrixClient,
    {
      badRequest: function (message: string) {
        return new Response(JSON.stringify({ errors: message }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': SupportedMimeType.Session },
        });
      },
      createResponse: function (
        body: BodyInit | null | undefined,
        init: ResponseInit | undefined,
      ) {
        return new Response(body, init);
      },
      createJWT: async (user: string, sessionRoom: string) =>
        createJWT({ user, sessionRoom }, realmSecretSeed),
      ensureSessionRoom: async (userId: string) => {
        const realmServerUserId = matrixClient.getUserId();
        if (!realmServerUserId) {
          throw new Error(
            'Realm server Matrix user ID is not available, unable to create session room',
          );
        }
        let sessionRoom = await fetchSessionRoom(
          dbAdapter,
          realmServerUserId,
          userId,
        );

        if (!sessionRoom) {
          sessionRoom = await matrixClient.createDM(userId);
          await upsertSessionRoom(
            dbAdapter,
            realmServerUserId,
            userId,
            sessionRoom,
          );
        }
        return sessionRoom;
      },
    } as Utils,
  );

  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      let request = await fetchRequestFromContext(ctxt);
      let response = await matrixBackendAuthentication.createSession(request);
      await setContextResponse(ctxt, response);
    } catch (e: any) {
      log.error(`Exception while creating a session on realm server`, e);
      await sendResponseForSystemError(ctxt, `${e.message}: at ${e.stack}`);
    }
  };
}
