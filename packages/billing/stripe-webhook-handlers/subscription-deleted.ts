import { DBAdapter } from '@cardstack/runtime-common';
import { StripeSubscriptionDeletedWebhookEvent } from '.';
import {
  insertStripeEvent,
  updateSubscription,
  markStripeEventAsProcessed,
  getSubscriptionByStripeSubscriptionId,
  sumUpCreditsLedger,
  addToCreditsLedger,
  getMostRecentSubscriptionCycle,
} from '../billing-queries';

import { PgAdapter, TransactionManager } from '@cardstack/postgres';
import Stripe from 'stripe';



let stripe: Stripe;

export function getStripe() {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  }

  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_WEBHOOK_SECRET);
  }

  return stripe;
}

export async function handleSubscriptionDeleted(
  dbAdapter: DBAdapter,
  event: StripeSubscriptionDeletedWebhookEvent,
) {
  // It is configured in Stripe that in case the user cancels the subscription using the customer portal,
  // it will be applied at the end of the billing period, not immediately. This means we can safely expire
  // all the plan allowance credits for the subscription that is being canceled (deleted).

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

    let currentSubscriptionCycle = await getMostRecentSubscriptionCycle(
      dbAdapter,
      subscription.id,
    );

    if (!currentSubscriptionCycle) {
      throw new Error(
        'Should never get here: no current subscription cycle found when renewing',
      );
    }

    let creditsToExpire = await sumUpCreditsLedger(dbAdapter, {
      creditType: ['plan_allowance', 'plan_allowance_used'],
      subscriptionCycleId: currentSubscriptionCycle.id,
    });

    await addToCreditsLedger(dbAdapter, {
      userId: subscription.userId,
      creditAmount: -creditsToExpire,
      creditType: 'plan_allowance_expired',
      subscriptionCycleId: currentSubscriptionCycle.id,
    });

    // This happens when the payment method fails for a couple of times and then Stripe subscription gets expired.
    if (newStatus === 'expired') {
      await subcribeUserToFreePlan(event.data.object.customer);
    }

    await markStripeEventAsProcessed(dbAdapter, event.id);
  });
}

async function subcribeUserToFreePlan(stripeCustomerId: string) {
  try {
    await getStripe().subscriptions.create({
      customer: stripeCustomerId,
      items: [
        {
          price: '0'
        }
      ],
    });
  } catch(err) {
    console.error(`Failed to subscribe user back to free plan, error:`, err);
  }
}
