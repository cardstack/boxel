import type { DBAdapter } from '@cardstack/runtime-common';
import { reportError } from '@cardstack/runtime-common';
import type { StripeSubscriptionDeletedWebhookEvent } from '.';
import {
  insertStripeEvent,
  updateSubscription,
  markStripeEventAsProcessed,
  getSubscriptionByStripeSubscriptionId,
  sumUpCreditsLedger,
  addToCreditsLedger,
  getMostRecentSubscriptionCycle,
  getPlanByMonthlyPrice,
} from '../billing-queries';

import type { PgAdapter } from '@cardstack/postgres';
import { TransactionManager } from '@cardstack/postgres';
import { getStripe } from './stripe';

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
      await subscribeUserToFreePlan(dbAdapter, event.data.object.customer);
    }

    await markStripeEventAsProcessed(dbAdapter, event.id);
  });
}

async function subscribeUserToFreePlan(
  dbAdapter: DBAdapter,
  stripeCustomerId: string,
) {
  let stripe = getStripe();
  let freePlan = await getPlanByMonthlyPrice(dbAdapter, 0);
  if (!freePlan) {
    throw new Error('Free plan is not found');
  }
  let prices = await stripe.prices.list({
    product: freePlan.stripePlanId,
    active: true,
  });
  if (!prices.data[0]) {
    throw new Error('No price found for free plan');
  }

  try {
    // After this endpoint is called, Stripe will trigger the `invoice.payment_succeeded` event.
    // Our webhook handler will process this event to activate the subscription
    // and grant the user any associated allowances.
    await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [
        {
          price: prices.data[0].id,
        },
      ],
      payment_behavior: 'error_if_incomplete',
    });
  } catch (e: any) {
    reportError(e);
    console.error(`Failed to subscribe user back to free plan, error:`, e);
  }
}
