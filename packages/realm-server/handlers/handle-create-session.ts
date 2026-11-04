import {
  EXTENDED_SESSION_TOKEN_TTL,
  logger,
  SESSION_TOKEN_TTL,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { Utils } from '@cardstack/runtime-common/matrix-backend-authentication';
import { MatrixBackendAuthentication } from '@cardstack/runtime-common/matrix-backend-authentication';
import type Koa from 'koa';
import { createJWT } from '../utils/jwt.ts';
import {
  fetchRequestFromContext,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { ensureSessionRoom } from '../lib/session-room.ts';

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
      createJWT: async (
        user: string,
        sessionRoom: string,
        opts?: { extendedLifetime?: boolean },
      ) =>
        createJWT(
          { user, sessionRoom },
          realmSecretSeed,
          opts?.extendedLifetime
            ? EXTENDED_SESSION_TOKEN_TTL
            : SESSION_TOKEN_TTL,
        ),
      ensureSessionRoom: async (userId: string) =>
        await ensureSessionRoom({ dbAdapter, matrixClient }, userId),
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
