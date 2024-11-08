import { DBAdapter } from '@cardstack/runtime-common';
import {
  Plan,
  Subscription,
  SubscriptionCycle,
  User,
  addToCreditsLedger,
  expireRemainingPlanAllowanceInSubscriptionCycle,
  getCurrentActiveSubscription,
  getMostRecentSubscriptionCycle,
  getPlanById,
  getPlanByStripeId,
  getUserByStripeId,
  insertStripeEvent,
  insertSubscription,
  insertSubscriptionCycle,
  markStripeEventAsProcessed,
  sumUpCreditsLedger,
  updateSubscription as updateSubscriptionQuery,
} from '../billing-queries';
import { StripeInvoicePaymentSucceededWebhookEvent } from '.';

import PgAdapter from '../../pg-adapter';
import { retry } from '../../lib/utils';
import { TransactionManager } from '../../pg-transaction-manager';

// TODOs that will be handled in a separated PRs:
// - signal to frontend that subscription has been created and credits have been added
// - put this in a background job

export async function handlePaymentSucceeded(
  dbAdapter: DBAdapter,
  event: StripeInvoicePaymentSucceededWebhookEvent,
): Promise<void> {
  // We want a transaction so we don't reach an inconsistent DB state if something breaks in the middle of this function
  let txManager = new TransactionManager(dbAdapter as PgAdapter);

  await txManager.withTransaction(async () => {
    await insertStripeEvent(dbAdapter, event);

    let productId = event.data.object.lines.data.find(
      (line) => line.amount >= 0, // We are only interested in the product of the invoice line where the amount is 0 (free plan) or positive (paid plans). There could be other lines with negative amounts, for example prorations for previous plans
    )?.price?.product;

    if (!productId) {
      throw new Error('No valid product found in payment event');
    }

    let plan = await getPlanByStripeId(dbAdapter, productId);
    if (!plan) {
      throw new Error(`No plan found for product id: ${productId}`);
    }

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

    let billingReason:
      | 'subscription_create'
      | 'subscription_cycle'
      | 'subscription_update' = event.data.object.billing_reason;

    if (billingReason === 'subscription_create') {
      await createSubscription(dbAdapter, {
        user,
        plan,
        creditAllowance: plan.creditsIncluded,
        periodStart: event.data.object.period_start,
        periodEnd: event.data.object.period_end,
        event,
      });
    } else if (billingReason === 'subscription_cycle') {
      await createSubscriptionCycle(dbAdapter, user, plan, event);
    } else if (billingReason === 'subscription_update') {
      await updateSubscription(dbAdapter, user, plan, event);
    }

    await markStripeEventAsProcessed(dbAdapter, event.id);
  });
}

async function createSubscription(
  dbAdapter: DBAdapter,
  {
    user,
    plan,
    creditAllowance,
    periodStart,
    periodEnd,
    event,
  }: {
    user: User;
    plan: Plan;
    creditAllowance: number;
    periodStart: number;
    periodEnd: number;
    event: StripeInvoicePaymentSucceededWebhookEvent;
  },
) {
  let subscription = await insertSubscription(dbAdapter, {
    user_id: user.id,
    plan_id: plan.id,
    started_at: periodStart,
    status: 'active',
    stripe_subscription_id: event.data.object.subscription,
  });

  let subscriptionCycle = await insertSubscriptionCycle(dbAdapter, {
    subscriptionId: subscription.id,
    periodStart,
    periodEnd,
  });

  await addToCreditsLedger(dbAdapter, {
    userId: user.id,
    creditAmount: creditAllowance,
    creditType: 'plan_allowance',
    subscriptionCycleId: subscriptionCycle.id,
  });
}

async function updateSubscription(
  dbAdapter: DBAdapter,
  user: User,
  plan: Plan,
  event: StripeInvoicePaymentSucceededWebhookEvent,
) {
  let existingActiveSubscription = await getCurrentActiveSubscription(
    dbAdapter,
    user.id,
  );

  if (!existingActiveSubscription) {
    throw new Error(
      'This should never happen: no active subscription found when updating a subscription',
    );
  }

  let currentCycle = await getMostRecentSubscriptionCycle(
    dbAdapter,
    existingActiveSubscription.id,
  );
  if (!currentCycle) {
    throw new Error(
      'This should never happen: no current subscription cycle for active subscription',
    );
  }

  let currentPlan = await getPlanById(
    dbAdapter,
    existingActiveSubscription.planId,
  );
  let newPlan = plan;

  if (!currentPlan) {
    throw new Error(
      'This should never happen: current plan not found when trying to update subscription',
    );
  }

  let isDowngrade = currentPlan.monthlyPrice > newPlan.monthlyPrice;

  if (isDowngrade) {
    await handlePlanDowngrade(dbAdapter, {
      user,
      currentCycle,
      newPlan,
      existingActiveSubscription,
      event,
    });
  } else {
    await handlePlanUpgrade(dbAdapter, {
      user,
      currentCycle,
      newPlan,
      existingActiveSubscription,
      event,
    });
  }
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

  await expireRemainingPlanAllowanceInSubscriptionCycle(
    dbAdapter,
    user.id,
    currentSubscriptionCycle.id,
  );

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

async function handlePlanDowngrade(
  dbAdapter: DBAdapter,
  {
    user,
    currentCycle,
    newPlan,
    existingActiveSubscription,
    event,
  }: {
    user: User;
    currentCycle: SubscriptionCycle;
    newPlan: Plan;
    existingActiveSubscription: Subscription;
    event: StripeInvoicePaymentSucceededWebhookEvent;
  },
) {
  let newPeriodStart = event.data.object.period_start;
  let newPeriodEnd = event.data.object.period_end;

  await expireRemainingPlanAllowanceInSubscriptionCycle(
    dbAdapter,
    user.id,
    currentCycle.id,
  );

  await updateSubscriptionQuery(dbAdapter, existingActiveSubscription.id, {
    status: 'ended_due_to_plan_change',
    endedAt: newPeriodStart,
  });

  await createSubscription(dbAdapter, {
    user,
    plan: newPlan,
    creditAllowance: newPlan.creditsIncluded,
    periodStart: newPeriodStart,
    periodEnd: newPeriodEnd,
    event,
  });
}

async function handlePlanUpgrade(
  dbAdapter: DBAdapter,
  {
    user,
    currentCycle,
    newPlan,
    existingActiveSubscription,

    event,
  }: {
    user: User;
    currentCycle: SubscriptionCycle;
    newPlan: Plan;
    existingActiveSubscription: Subscription;
    event: StripeInvoicePaymentSucceededWebhookEvent;
  },
) {
  let centsToCredits = (cents: number, plan: Plan) =>
    Math.round((cents / (plan.monthlyPrice * 100)) * plan.creditsIncluded);

  // Sum up monetary credit given to the user by Stripe for unused time on previous plans
  // (there can be multiple such lines if user switches to larger plans multiple times in the same billing period)
  // and convert it to credits. In other words, take away the credits calculated from the money that Stripe
  // returned to the user for unused time.
  let creditsToExpireforUnusedTimeOnPreviousPlans = 0;
  for (const line of event.data.object.lines.data) {
    if (line.amount > 0) {
      continue;
    }
    let plan = await getPlanByStripeId(dbAdapter, line.price.product);
    if (plan) {
      creditsToExpireforUnusedTimeOnPreviousPlans += centsToCredits(
        -line.amount,
        plan,
      );
    }
  }

  let newPlanInvoiceLine = event.data.object.lines.data.find(
    (line) => line.price.product === newPlan.stripePlanId,
  );

  if (!newPlanInvoiceLine) {
    throw new Error(
      `No new plan subscription line found in invoice for plan ${newPlan.name} (stripe id: ${newPlan.stripePlanId})`,
    );
  }

  // Convert the amount Stripe charged the user for the remaining time on the new plan into credits
  // Stripe will charge the user in a prorated way for the new plan, meaning that the user will be
  // charged for the time that is left in the billing period proportionally to the plan price
  let creditsToAddForRemainingTimeOnNewPlan = centsToCredits(
    newPlanInvoiceLine.amount,
    newPlan,
  );

  let currentAllowance = await sumUpCreditsLedger(dbAdapter, {
    creditType: ['plan_allowance', 'plan_allowance_used'],
    subscriptionCycleId: currentCycle.id,
  });

  let creditsToAddToNewSubscriptionAllowance =
    currentAllowance -
    creditsToExpireforUnusedTimeOnPreviousPlans +
    creditsToAddForRemainingTimeOnNewPlan;

  await expireRemainingPlanAllowanceInSubscriptionCycle(
    dbAdapter,
    user.id,
    currentCycle.id,
  );

  await updateSubscriptionQuery(dbAdapter, existingActiveSubscription.id, {
    status: 'ended_due_to_plan_change',
    endedAt: event.data.object.period_end,
  });

  await createSubscription(dbAdapter, {
    user,
    plan: newPlan,
    creditAllowance: creditsToAddToNewSubscriptionAllowance,
    periodStart: newPlanInvoiceLine.period.start,
    periodEnd: newPlanInvoiceLine.period.end,
    event,
  });
}
