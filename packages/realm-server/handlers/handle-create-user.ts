import { upsertUser } from '@cardstack/runtime-common';
import Koa from 'koa';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { RealmServerTokenClaim } from '../utils/jwt';
import { CreateRoutesArgs } from '../routes';

export default function handleCreateUserRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to create user',
      );
      return;
    }

    let { user: matrixUserId } = token;

    let request = await fetchRequestFromContext(ctxt);
    let body = await request.text();
    let json: Record<string, any>;
    try {
      json = JSON.parse(body);
    } catch (e) {
      await sendResponseForBadRequest(
        ctxt,
        'Request body is not valid JSON-API - invalid JSON',
      );
      return;
    }

    let registrationToken = json.data.attributes.registrationToken;

    await upsertUser(dbAdapter, matrixUserId, registrationToken);
    await setContextResponse(ctxt, new Response('ok'));
  };
}
