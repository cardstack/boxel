import { DBAdapter } from '@cardstack/runtime-common';
import { StripeSubscriptionDeletedWebhookEvent } from '.';
import {
  getStripeEventById,
  insertStripeEvent,
  updateSubscription,
} from '../billing_queries';
import { getSubscriptionByStripeSubscriptionId } from '../billing_queries';
import { TransactionManager } from '../../pg-transaction-manager';
import PgAdapter from '../../pg-adapter';
import { markStripeEventAsProcessed } from '../billing_queries';

export async function handleSubscriptionDeleted(
  dbAdapter: DBAdapter,
  event: StripeSubscriptionDeletedWebhookEvent,
) {
  let txManager = new TransactionManager(dbAdapter as PgAdapter);

  await txManager.withTransaction(async () => {
    try {
      await insertStripeEvent(dbAdapter, event);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('duplicate key value')
      ) {
        let stripeEvent = await getStripeEventById(dbAdapter, event.id);
        if (stripeEvent?.is_processed) {
          throw new Error('Stripe event already processed');
        }
      }
      throw error;
    }

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

    await markStripeEventAsProcessed(dbAdapter, event.id);
  });
}
