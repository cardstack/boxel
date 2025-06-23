import { insertUser } from '@cardstack/runtime-common';
import Koa from 'koa';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { RealmServerTokenClaim } from '../utils/jwt';
import { CreateRoutesArgs } from '../routes';
import {
  User,
  addToCreditsLedger,
  getUserByMatrixUserId,
} from '@cardstack/billing/billing-queries';

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

    let user;

    try {
      user = await insertUser(dbAdapter, matrixUserId, registrationToken);
    } catch (e) {
      // TODO: detect if the error is because the user already exists
      await setContextResponse(
        ctxt,
        new Response('User already exists', { status: 422 }),
      );
      return;
    }

    await addToCreditsLedger(dbAdapter, {
      userId: user!.id,
      creditAmount: 1000,
      creditType: 'extra_credit',
      subscriptionCycleId: null,
    });

    await setContextResponse(ctxt, new Response('ok'));
  };
}
