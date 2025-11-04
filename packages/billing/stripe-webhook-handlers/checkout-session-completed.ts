import type { DBAdapter } from '@cardstack/runtime-common';
import {
  addToCreditsLedger,
  getCurrentActiveSubscription,
  getMostRecentSubscriptionCycle,
  getUserById,
  insertStripeEvent,
  markStripeEventAsProcessed,
  updateUserStripeCustomerEmail,
} from '../billing-queries';
import type { StripeCheckoutSessionCompletedWebhookEvent } from '.';

import type { PgAdapter } from '@cardstack/postgres';
import { TransactionManager } from '@cardstack/postgres';

export async function handleCheckoutSessionCompleted(
  dbAdapter: DBAdapter,
  event: StripeCheckoutSessionCompletedWebhookEvent,
) {
  let txManager = new TransactionManager(dbAdapter as PgAdapter);

  await txManager.withTransaction(async () => {
    await insertStripeEvent(dbAdapter, event);

    let stripeCustomerId = event.data.object.customer;
    let userId = event.data.object.metadata.user_id; // We are adding this in handle-create-stripe-session.ts

    if (!userId) {
      throw new Error(
        'No user id found in checkout session completed event - this should be populated using metadata in the payment link',
      );
    }

    let user = await getUserById(dbAdapter, userId);

    if (!user) {
      throw new Error(`User not found for id: ${userId}`);
    }

    let stripeCustomerEmail = event.data.object.customer_details?.email;

    let creditReloadAmount =
      'credit_reload_amount' in event.data.object.metadata
        ? parseInt(event.data.object.metadata.credit_reload_amount)
        : null;

    if (creditReloadAmount) {
      let subscriptionCycleId;

      if (stripeCustomerId) {
        await updateUserStripeCustomerEmail(
          dbAdapter,
          stripeCustomerId,
          stripeCustomerEmail,
        );

        let subscription = await getCurrentActiveSubscription(
          dbAdapter,
          user.id,
        );

        if (subscription) {
          let subscriptionCycle = await getMostRecentSubscriptionCycle(
            dbAdapter,
            subscription!.id,
          );

          subscriptionCycleId = subscriptionCycle?.id;
        }
      }

      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: creditReloadAmount,
        creditType: 'extra_credit',
        subscriptionCycleId: subscriptionCycleId ?? null,
      });
    }
  });

  await markStripeEventAsProcessed(dbAdapter, event.id);
}
