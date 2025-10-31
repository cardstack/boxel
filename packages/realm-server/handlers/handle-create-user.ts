import { insertUser } from '@cardstack/runtime-common';
import type Koa from 'koa';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { RealmServerTokenClaim } from '../utils/jwt';
import type { CreateRoutesArgs } from '../routes';
import { addToCreditsLedger } from '@cardstack/billing/billing-queries';

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
      let errorMessage: string;
      if (
        (e as Error).message.includes(
          'duplicate key value violates unique constraint',
        )
      ) {
        errorMessage = 'User already exists';
      } else {
        errorMessage = 'Unknown error creating user';
      }

      await setContextResponse(
        ctxt,
        new Response(errorMessage, { status: 422 }),
      );
      return;
    }

    // When user signs up, they get 1000 credits and no stripe subscription is needed
    // In this case we don't need to create a subscription cycle, just add the credits to the user
    await addToCreditsLedger(dbAdapter, {
      userId: user!.id,
      creditAmount: 1000,
      creditType: 'extra_credit',
      subscriptionCycleId: null,
    });

    await setContextResponse(ctxt, new Response('ok'));
  };
}
