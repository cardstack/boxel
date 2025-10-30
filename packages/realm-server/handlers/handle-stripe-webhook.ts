import type Koa from 'koa';
import { fetchRequestFromContext, setContextResponse } from '../middleware';
import stripeWebhookHandler from '@cardstack/billing/stripe-webhook-handlers';
import type { CreateRoutesArgs } from '../routes';

export default function handleStripeWebhookRequest({
  dbAdapter,
  sendEvent,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let request = await fetchRequestFromContext(ctxt);

    let response = await stripeWebhookHandler({
      dbAdapter,
      request,
      sendMatrixEvent: sendEvent,
    });
    await setContextResponse(ctxt, response);
  };
}
