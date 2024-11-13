import { type DBAdapter } from '@cardstack/runtime-common';
import {
  insertStripeEvent,
  markStripeEventAsProcessed,
  updateUserStripeCustomerId,
} from '../billing-queries';
import { StripeCheckoutSessionCompletedWebhookEvent } from '.';

import { PgAdapter, TransactionManager } from '@cardstack/postgres';

export async function handleCheckoutSessionCompleted(
  dbAdapter: DBAdapter,
  event: StripeCheckoutSessionCompletedWebhookEvent,
) {
  let txManager = new TransactionManager(dbAdapter as PgAdapter);

  await txManager.withTransaction(async () => {
    await insertStripeEvent(dbAdapter, event);

    const stripeCustomerId = event.data.object.customer;
    const matrixUserName = event.data.object.client_reference_id;

    await updateUserStripeCustomerId(
      dbAdapter,
      matrixUserName,
      stripeCustomerId,
    );
    await markStripeEventAsProcessed(dbAdapter, event.id);
  });
}
