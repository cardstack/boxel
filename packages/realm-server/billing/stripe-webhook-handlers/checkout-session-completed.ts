import { DBAdapter } from '@cardstack/runtime-common';
import {
  insertStripeEvent,
  updateUserStripeCustomerId,
} from '../billing-queries';
import { StripeCheckoutSessionCompletedWebhookEvent } from '.';

export async function handleCheckoutSessionCompleted(
  dbAdapter: DBAdapter,
  event: StripeCheckoutSessionCompletedWebhookEvent,
): Promise<Response> {
  await insertStripeEvent(dbAdapter, event);

  const stripeCustomerId = event.data.object.customer;
  const matrixUserName = event.data.object.client_reference_id;

  await updateUserStripeCustomerId(dbAdapter, matrixUserName, stripeCustomerId);

  return new Response('ok');
}
