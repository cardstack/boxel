import Koa from 'koa';
import { fetchRequestFromContext, setContextResponse } from '../middleware';
import stripeWebhookHandler from '@cardstack/billing/stripe-webhook-handlers';
import { CreateRoutesArgs } from '../routes';
import { getUserByStripeId } from '@cardstack/billing/billing-queries';

export default function handleStripeWebhookRequest({
  dbAdapter,
  sendEvent,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let request = await fetchRequestFromContext(ctxt);

    let response = await stripeWebhookHandler(
      dbAdapter,
      request,
      async (stripeUserId: string) => {
        let user = await getUserByStripeId(dbAdapter, stripeUserId);
        if (user) {
          await sendEvent(user.matrixUserId, 'billing-notification');
        }
      },
    );
    await setContextResponse(ctxt, response);
  };
}
