import {
  fetchSessionRoom,
  logger,
  REALM_SERVER_REALM,
  SupportedMimeType,
  upsertSessionRoom,
} from '@cardstack/runtime-common';
import {
  MatrixBackendAuthentication,
  Utils,
} from '@cardstack/runtime-common/matrix-backend-authentication';
import Koa from 'koa';
import { createJWT } from '../utils/jwt';
import {
  fetchRequestFromContext,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { CreateRoutesArgs } from '../routes';

const log = logger('realm-server');

export default function handleCreateSessionRequest({
  matrixClient,
  realmSecretSeed,
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let matrixBackendAuthentication = new MatrixBackendAuthentication(
    matrixClient,
    realmSecretSeed,
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
        let sessionRoom = await fetchSessionRoom(
          dbAdapter,
          REALM_SERVER_REALM,
          userId,
        );

        if (!sessionRoom) {
          sessionRoom = await matrixClient.createDM(userId);
          await upsertSessionRoom(
            dbAdapter,
            REALM_SERVER_REALM,
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
