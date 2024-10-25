import {
  DBAdapter,
  Expression,
  addExplicitParens,
  asExpressions,
  param,
  query,
  separatedByCommas,
} from '@cardstack/runtime-common';
import {
  StripeEvent,
  addCreditsToUser,
  getPlanByStripeId,
  getUserByStripeId,
  insertStripeEvent,
  insertSubscription,
  insertSubscriptionCycle,
  insertUserStripeCustomerId,
} from '../billing_queries';

export async function handlePaymentSucceeded(
  dbAdapter: DBAdapter,
  event: StripeEvent,
): Promise<Response> {
  await insertStripeEvent(dbAdapter, event);
  // TODO: this needs to be an idempotent background job
  // TODO: ideally do this in one DB transaction
  // TODO: return early if stripe event is already processed
  // TODO: implement renewals (billing_reason === 'subscription_cycle')
  // TODO: handle plan changes (going from smaller plan to bigger plan, or vice versa)
  // TODO: signal to frontend that subscription has been created and credits have been added

  let plan = await getPlanByStripeId(
    dbAdapter,
    event.data.object.lines.data[0].plan.product,
  );
  let user = await getUserByStripeId(dbAdapter, event.data.object.customer);

  if (!user) {
    // TODO: if user doesn't exist, we need to wait until the webhook that handles
    // checkout.session.completed event is completed (which updates stripe customer id after user initially signs up for a plan)
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

    await addCreditsToUser(
      dbAdapter,
      user.id,
      plan.credits_included,
      'plan_allowance',
      subscriptionCycle.id,
    );
  } else if (billingReason === 'subscription_cycle') {
    throw new Error('TODO');
  }

  await query(dbAdapter, [
    `UPDATE stripe_events SET is_processed = TRUE WHERE stripe_event_id = `,
    param(event.id),
  ]);

  return new Response('ok');
}

export async function handleCheckoutSessionCompleted(
  dbAdapter: DBAdapter,
  event: StripeEvent,
): Promise<Response> {
  // Scenario 1: a user completes initial subscription through checkout session
  // Scenario 2: a user resubscribes to a plan or upgrades/downgrades their plan

  // TODO: handle scenario 2 to not create new user if user already exists

  await insertStripeEvent(dbAdapter, event);

  const stripeCustomerId = event.data.object.customer;
  const matrixUserName = event.data.object.client_reference_id;

  await insertUserStripeCustomerId(dbAdapter, matrixUserName, stripeCustomerId);

  return new Response('ok');
}
