import { DBAdapter } from '@cardstack/runtime-common';
import {
  addToCreditsLedger,
  getCurrentActiveSubscription,
  getMostRecentSubscriptionCycle,
  getPlanByStripeId,
  getStripeEventById,
  getUserByStripeId,
  insertStripeEvent,
  insertSubscription,
  insertSubscriptionCycle,
  markStripeEventAsProcessed,
  sumUpCreditsLedger,
} from '../billing_queries';
import { StripeInvoicePaymentSucceededWebhookEvent } from '.';

import PgAdapter from '../../pg-adapter';
import { retry } from '../../lib/utils';
import { TransactionManager } from '../../pg-transaction-manager';

// TODOs that will be handled in a separated PRs:
// - handle plan changes (going from smaller plan to bigger plan, or vice versa) - this will be handled in a separate ticket CS-7444
// - signal to frontend that subscription has been created and credits have been added
// - put this in a background job
export async function handlePaymentSucceeded(
  dbAdapter: DBAdapter,
  event: StripeInvoicePaymentSucceededWebhookEvent,
): Promise<void> {
  // We want a transaction so we don't reach an inconsistent DB state if something breaks in the middle of this function
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

    let plan = await getPlanByStripeId(
      dbAdapter,
      event.data.object.lines.data[0].price.product,
    );

    // When user first signs up for a plan, our checkout.session.completed handler takes care of assigning the user a stripe customer id.
    // Stripe customer id is needed so that we can recognize the user when their subscription is renewed, or canceled.
    // The mentioned webhook should be sent before this one, but if there are any network or processing delays,
    // it is not guaranteed that the user will have a stripe customer id until we get to here. That's why we want to retry
    // a couple of times with a delay in between.
    let user = await retry(
      () => getUserByStripeId(dbAdapter, event.data.object.customer),
      { retries: 5, delayMs: 1000 },
    );

    if (!user) {
      throw new Error(
        `Unrecognized stripe customer id ${event.data.object.customer}`,
      );
    }

    let billingReason: 'subscription_create' | 'subscription_cycle' =
      event.data.object.billing_reason;

    if (billingReason === 'subscription_create') {
      await createSubscription(dbAdapter, user, plan, event);
    } else if (billingReason === 'subscription_cycle') {
      await createSubscriptionCycle(dbAdapter, user, plan, event);
    }

    await markStripeEventAsProcessed(dbAdapter, event.id);
  });
}

async function createSubscription(
  dbAdapter: DBAdapter,
  user: { id: string },
  plan: { id: string; creditsIncluded: number },
  event: StripeInvoicePaymentSucceededWebhookEvent,
) {
  let subscription = await insertSubscription(dbAdapter, {
    user_id: user.id,
    plan_id: plan.id,
    started_at: event.data.object.period_start,
    status: 'active',
    stripe_subscription_id: event.data.object.subscription,
  });

  let subscriptionCycle = await insertSubscriptionCycle(dbAdapter, {
    subscriptionId: subscription.id,
    periodStart: event.data.object.period_start,
    periodEnd: event.data.object.period_end,
  });

  await addToCreditsLedger(dbAdapter, {
    userId: user.id,
    creditAmount: plan.creditsIncluded,
    creditType: 'plan_allowance',
    subscriptionCycleId: subscriptionCycle.id,
  });
}

async function createSubscriptionCycle(
  dbAdapter: DBAdapter,
  user: { id: string },
  plan: { creditsIncluded: number },
  event: StripeInvoicePaymentSucceededWebhookEvent,
) {
  let currentActiveSubscription = await getCurrentActiveSubscription(
    dbAdapter,
    user.id,
  );

  if (!currentActiveSubscription) {
    throw new Error(
      'Should never get here: no active subscription found when renewing',
    );
  }

  let currentSubscriptionCycle = await getMostRecentSubscriptionCycle(
    dbAdapter,
    currentActiveSubscription.id,
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
    userId: user.id,
    creditAmount: -creditsToExpire,
    creditType: 'plan_allowance_expired',
    subscriptionCycleId: currentSubscriptionCycle.id,
  });

  let newSubscriptionCycle = await insertSubscriptionCycle(dbAdapter, {
    subscriptionId: currentActiveSubscription.id,
    periodStart: event.data.object.period_start,
    periodEnd: event.data.object.period_end,
  });

  await addToCreditsLedger(dbAdapter, {
    userId: user.id,
    creditAmount: plan.creditsIncluded,
    creditType: 'plan_allowance',
    subscriptionCycleId: newSubscriptionCycle.id,
  });
}
