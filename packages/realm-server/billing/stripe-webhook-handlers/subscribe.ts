import { DBAdapter, param, query } from '@cardstack/runtime-common';
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
  sumUpCreditsLedger,
} from '../billing_queries';
import { StripeEvent } from '.';

export async function handlePaymentSucceeded(
  dbAdapter: DBAdapter,
  event: StripeEvent,
): Promise<void> {
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

  // TODO: this needs to be an idempotent background job
  // TODO: ideally do this in one DB transaction
  // TODO: handle plan changes (going from smaller plan to bigger plan, or vice versa)
  // TODO: signal to frontend that subscription has been created and credits have been added

  let plan = await getPlanByStripeId(
    dbAdapter,
    event.data.object.lines.data[0].plan.product,
  );
  let user = await getUserByStripeId(dbAdapter, event.data.object.customer);

  if (!user) {
    // TODO: if user doesn't exist, we need to wait until the webhook that handles
    // checkout.session.completed event (https://github.com/cardstack/boxel/pull/1720)
    // is completed (which updates stripe customer id after user initially signs up for a plan)

    // TODO: retry a couple of times spaced out by a couple of seconds
    throw new Error('User not found');
  }

  let billingReason: 'subscription_create' | 'subscription_cycle' =
    event.data.object.billing_reason;

  if (billingReason === 'subscription_create') {
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

    await addToCreditsLedger(
      dbAdapter,
      user.id,
      plan.creditsIncluded,
      'plan_allowance',
      subscriptionCycle.id,
    );
  } else if (billingReason === 'subscription_cycle') {
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

    await addToCreditsLedger(
      dbAdapter,
      user.id,
      -creditsToExpire,
      'plan_allowance_expired',
      currentSubscriptionCycle.id,
    );

    let newSubscriptionCycle = await insertSubscriptionCycle(dbAdapter, {
      subscriptionId: currentActiveSubscription.id,
      periodStart: event.data.object.period_start,
      periodEnd: event.data.object.period_end,
    });

    await addToCreditsLedger(
      dbAdapter,
      user.id,
      plan.creditsIncluded,
      'plan_allowance',
      newSubscriptionCycle.id,
    );
  }
  await query(dbAdapter, [
    `UPDATE stripe_events SET is_processed = TRUE WHERE stripe_event_id = `,
    param(event.id),
  ]);
}
