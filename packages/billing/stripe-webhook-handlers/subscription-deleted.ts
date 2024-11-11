import { DBAdapter } from '@cardstack/runtime-common';
import { StripeSubscriptionDeletedWebhookEvent } from '.';
import {
  insertStripeEvent,
  updateSubscription,
  markStripeEventAsProcessed,
  getSubscriptionByStripeSubscriptionId,
} from '../billing-queries';

import { PgAdapter, TransactionManager } from '@cardstack/postgres';

export async function handleSubscriptionDeleted(
  dbAdapter: DBAdapter,
  event: StripeSubscriptionDeletedWebhookEvent,
) {
  let txManager = new TransactionManager(dbAdapter as PgAdapter);

  await txManager.withTransaction(async () => {
    await insertStripeEvent(dbAdapter, event);

    let subscription = await getSubscriptionByStripeSubscriptionId(
      dbAdapter,
      event.data.object.id,
    );

    if (!subscription) {
      throw new Error(
        `Cannot delete subscription ${event.data.object.id}: not found`,
      );
    }

    let newStatus =
      event.data.object.cancellation_details.reason === 'cancellation_requested'
        ? 'canceled'
        : 'expired';

    await updateSubscription(dbAdapter, subscription.id, {
      status: newStatus,
      endedAt: event.data.object.canceled_at,
    });

    // This happens when the payment method fails for a couple of times and then Stripe subscription gets expired.
    if (newStatus === 'expired') {
      // TODO: Put the user back on the free plan (by calling Stripe API). Will be handled in CS-7466
    }

    await markStripeEventAsProcessed(dbAdapter, event.id);
  });
}
