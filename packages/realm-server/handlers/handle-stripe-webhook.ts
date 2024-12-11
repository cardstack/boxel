import Koa from 'koa';
import { fetchRequestFromContext, setContextResponse } from '../middleware';
import stripeWebhookHandler from '@cardstack/billing/stripe-webhook-handlers';
import { CreateRoutesArgs } from '../routes';
import { getUserByStripeId } from '@cardstack/billing/billing-queries';
import { decodeWebSafeBase64 } from '@cardstack/runtime-common';

export default function handleStripeWebhookRequest({
  dbAdapter,
  sendEvent,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let request = await fetchRequestFromContext(ctxt);

    let response = await stripeWebhookHandler(
      dbAdapter,
      request,
      async ({
        stripeCustomerId,
        encodedMatrixUserId,
      }: {
        stripeCustomerId?: string;
        encodedMatrixUserId?: string;
      }) => {
        let matrixUserId = encodedMatrixUserId
          ? decodeWebSafeBase64(encodedMatrixUserId)
          : undefined;
        if (stripeCustomerId) {
          let user = await getUserByStripeId(dbAdapter, stripeCustomerId);
          matrixUserId = user?.matrixUserId;
        }

        if (matrixUserId) {
          await sendEvent(matrixUserId, 'billing-notification');
        }
      },
    );
    await setContextResponse(ctxt, response);
  };
}
