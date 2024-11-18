import { param, query } from '@cardstack/runtime-common';
import { module, test } from 'qunit';
import {
  fetchSubscriptionsByUserId,
  insertPlan,
  insertUser,
  prepareTestDB,
} from './helpers';
import { PgAdapter } from '@cardstack/postgres';
import { handlePaymentSucceeded } from '@cardstack/billing/stripe-webhook-handlers/payment-succeeded';
import { handleSubscriptionDeleted } from '@cardstack/billing/stripe-webhook-handlers/subscription-deleted';
import { handleCheckoutSessionCompleted } from '@cardstack/billing/stripe-webhook-handlers/checkout-session-completed';
import {
  LedgerEntry,
  SubscriptionCycle,
  insertSubscriptionCycle,
  sumUpCreditsLedger,
  addToCreditsLedger,
  insertSubscription,
  User,
  spendCredits,
  Plan,
  Subscription,
} from '@cardstack/billing/billing-queries';

import {
  StripeInvoicePaymentSucceededWebhookEvent,
  StripeSubscriptionDeletedWebhookEvent,
  StripeCheckoutSessionCompletedWebhookEvent,
} from '@cardstack/billing/stripe-webhook-handlers';
import { add } from 'date-fns';

async function fetchStripeEvents(dbAdapter: PgAdapter) {
  return await query(dbAdapter, [`SELECT * FROM stripe_events`]);
}

async function fetchUserByStripeCustomerId(
  dbAdapter: PgAdapter,
  stripeCustomerId: string,
) {
  return await query(dbAdapter, [
    `SELECT * FROM users WHERE stripe_customer_id = `,
    param(stripeCustomerId),
  ]);
}

async function fetchSubscriptionCyclesBySubscriptionId(
  dbAdapter: PgAdapter,
  subscriptionId: string,
): Promise<SubscriptionCycle[]> {
  let results = await query(dbAdapter, [
    `SELECT * FROM subscription_cycles WHERE subscription_id = `,
    param(subscriptionId),
  ]);

  return results.map((result) => ({
    id: result.id as string,
    subscriptionId: result.subscription_id as string,
    periodStart: parseInt(result.period_start as string),
    periodEnd: parseInt(result.period_end as string),
  }));
}

async function fetchCreditsLedgerByUser(
  dbAdapter: PgAdapter,
  userId: string,
): Promise<LedgerEntry[]> {
  let results = await query(dbAdapter, [
    `SELECT * FROM credits_ledger WHERE user_id = `,
    param(userId),
  ]);

  return results.map(
    (result) =>
      ({
        id: result.id,
        userId: result.user_id,
        creditAmount: result.credit_amount,
        creditType: result.credit_type,
        subscriptionCycleId: result.subscription_cycle_id,
      }) as LedgerEntry,
  );
}

module('billing', function (hooks) {
  let dbAdapter: PgAdapter;

  hooks.beforeEach(async function () {
    prepareTestDB();
    dbAdapter = new PgAdapter({ autoMigrate: true });
  });

  hooks.afterEach(async function () {
    await dbAdapter.close();
  });

  module('invoice payment succeeded', function () {
    module('new subscription without any previous subscription', function () {
      test('creates a new subscription and adds plan allowance in credits', async function (assert) {
        let user = await insertUser(dbAdapter, 'user@test', 'cus_123');
        let plan = await insertPlan(
          dbAdapter,
          'Free plan',
          0,
          100,
          'prod_free',
        );

        // Omitted version of a real stripe invoice.payment_succeeded event
        let stripeInvoicePaymentSucceededEvent = {
          id: 'evt_1234567890',
          object: 'event',
          type: 'invoice.payment_succeeded',
          data: {
            object: {
              id: 'in_1234567890',
              object: 'invoice',
              amount_paid: 0, // free plan
              billing_reason: 'subscription_create',
              period_end: 1638465600,
              period_start: 1635873600,
              subscription: 'sub_1234567890',
              customer: 'cus_123',
              lines: {
                data: [
                  {
                    amount: 0,
                    price: { product: 'prod_free' },
                  },
                ],
              },
            },
          },
        } as StripeInvoicePaymentSucceededWebhookEvent;

        await handlePaymentSucceeded(
          dbAdapter,
          stripeInvoicePaymentSucceededEvent,
        );

        // Assert that the stripe event was inserted and processed
        let stripeEvents = await fetchStripeEvents(dbAdapter);
        assert.strictEqual(stripeEvents.length, 1);
        assert.strictEqual(
          stripeEvents[0].stripe_event_id,
          stripeInvoicePaymentSucceededEvent.id,
        );
        assert.true(stripeEvents[0].is_processed);

        // Assert that the subscription was created
        let subscriptions = await fetchSubscriptionsByUserId(
          dbAdapter,
          user.id,
        );
        assert.strictEqual(subscriptions.length, 1);
        let subscription = subscriptions[0];

        assert.strictEqual(subscription.userId, user.id);
        assert.strictEqual(subscription.planId, plan.id);
        assert.strictEqual(subscription.status, 'active');
        assert.strictEqual(subscription.stripeSubscriptionId, 'sub_1234567890');

        // Assert that the subscription cycle was created
        let subscriptionCycles = await fetchSubscriptionCyclesBySubscriptionId(
          dbAdapter,
          subscription.id,
        );
        assert.strictEqual(subscriptionCycles.length, 1);
        let subscriptionCycle = subscriptionCycles[0];

        assert.strictEqual(subscriptionCycle.subscriptionId, subscription.id);
        assert.strictEqual(
          subscriptionCycle.periodStart,
          stripeInvoicePaymentSucceededEvent.data.object.period_start,
        );
        assert.strictEqual(
          subscriptionCycle.periodEnd,
          stripeInvoicePaymentSucceededEvent.data.object.period_end,
        );

        // Assert that the credits were added to the user's balance
        let creditsLedger = await fetchCreditsLedgerByUser(dbAdapter, user.id);
        assert.strictEqual(creditsLedger.length, 1);
        let creditLedgerEntry = creditsLedger[0];
        assert.strictEqual(creditLedgerEntry.userId, user.id);
        assert.strictEqual(
          creditLedgerEntry.creditAmount,
          plan.creditsIncluded,
        );
        assert.strictEqual(creditLedgerEntry.creditType, 'plan_allowance');
        assert.strictEqual(
          creditLedgerEntry.subscriptionCycleId,
          subscriptionCycle.id,
        );

        // Error if stripe event is attempted to be processed again when it's already been processed
        await assert.rejects(
          handlePaymentSucceeded(dbAdapter, stripeInvoicePaymentSucceededEvent),
          'error: duplicate key value violates unique constraint "stripe_events_pkey"',
        );
      });
    });

    module('subscription update', function () {
      test('updates the subscription and prorates credits', async function (assert) {
        let user = await insertUser(dbAdapter, 'user@test', 'cus_123');
        let freePlan = await insertPlan(
          dbAdapter,
          'Free plan',
          0,
          1000,
          'prod_free',
        );
        let creatorPlan = await insertPlan(
          dbAdapter,
          'Creator',
          12,
          5000,
          'prod_creator',
        );
        let powerUserPlan = await insertPlan(
          dbAdapter,
          'Power User',
          49,
          25000,
          'prod_power_user',
        );

        let subscription = await insertSubscription(dbAdapter, {
          user_id: user.id,
          plan_id: freePlan.id,
          started_at: 1,
          status: 'active',
          stripe_subscription_id: 'sub_1234567890',
        });

        let subscriptionCycle = await insertSubscriptionCycle(dbAdapter, {
          subscriptionId: subscription.id,
          periodStart: 1,
          periodEnd: 2,
        });

        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 1000,
          creditType: 'plan_allowance',
          subscriptionCycleId: subscriptionCycle.id,
        });

        // User spent 500 credits from his plan allowance, now he has 500 left
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: -500,
          creditType: 'plan_allowance_used',
          subscriptionCycleId: subscriptionCycle.id,
        });

        let stripeInvoicePaymentSucceededEvent = {
          id: 'evt_1234567890',
          object: 'event',
          type: 'invoice.payment_succeeded',
          data: {
            object: {
              id: 'in_1234567890',
              object: 'invoice',
              amount_paid: creatorPlan.monthlyPrice * 100,
              billing_reason: 'subscription_update',
              period_start: 1,
              period_end: 2,
              subscription: 'sub_1234567890',
              customer: 'cus_123',
              lines: {
                data: [
                  {
                    amount: creatorPlan.monthlyPrice * 100,
                    price: { product: 'prod_creator' },
                    period: { start: 1, end: 2 },
                  },
                ],
              },
            },
          },
        } as StripeInvoicePaymentSucceededWebhookEvent;

        // User upgraded to the creator plan for $12
        await handlePaymentSucceeded(
          dbAdapter,
          stripeInvoicePaymentSucceededEvent,
        );

        // Assert that new subscription was created
        let subscriptions = await fetchSubscriptionsByUserId(
          dbAdapter,
          user.id,
        );
        assert.strictEqual(subscriptions.length, 2);

        // Assert that old subscription was ended due to plan change
        assert.strictEqual(subscriptions[0].status, 'ended_due_to_plan_change');
        assert.ok(subscriptions[0].endedAt);

        // Assert that new subscription is active
        assert.strictEqual(subscriptions[1].status, 'active');

        // Assert that there is a new subscription cycle
        let subscriptionCycles = await fetchSubscriptionCyclesBySubscriptionId(
          dbAdapter,
          subscriptions[1].id,
        );
        assert.strictEqual(subscriptionCycles.length, 1);
        assert.strictEqual(
          subscriptionCycles[0].periodStart,
          stripeInvoicePaymentSucceededEvent.data.object.period_start,
        );
        assert.strictEqual(
          subscriptionCycles[0].periodEnd,
          stripeInvoicePaymentSucceededEvent.data.object.period_end,
        );

        let creditsBalance = await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        });

        subscriptionCycle = subscriptionCycles[0];

        // User received 5000 credits from the creator plan, plus 500 from the plan allowance they had left from the free plan
        assert.strictEqual(creditsBalance, 5500);

        // User spent 2000 credits from the plan allowance
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: -2000,
          creditType: 'plan_allowance_used',
          subscriptionCycleId: subscriptionCycle.id,
        });

        // Assert that the user now has 3500 credits left
        creditsBalance = await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        });
        assert.strictEqual(creditsBalance, 3500);

        // Now, user upgrades to power user plan ($49 monthly) in the middle of the month:

        let amountCreditedForUnusedTimeOnPreviousPlan = 200;
        let amountCreditedForRemainingTimeOnNewPlan = 3800;

        stripeInvoicePaymentSucceededEvent = {
          id: 'evt_1234567891',
          object: 'event',
          type: 'invoice.payment_succeeded',
          data: {
            object: {
              id: 'in_1234567890',
              object: 'invoice',
              amount_paid: 3400, // prorated amount for going from creator to power user plan
              billing_reason: 'subscription_update',
              period_start: 3,
              period_end: 4,
              subscription: 'sub_1234567890',
              customer: 'cus_123',
              lines: {
                data: [
                  {
                    amount: -amountCreditedForUnusedTimeOnPreviousPlan,
                    description: 'Unused time on Creator plan',
                    price: { product: 'prod_creator' },
                    period: { start: 3, end: 4 },
                  },
                  {
                    amount: amountCreditedForRemainingTimeOnNewPlan,
                    description: 'Remaining time on Power User plan',
                    price: { product: 'prod_power_user' },
                    period: { start: 4, end: 5 },
                  },
                ],
              },
            },
          },
        } as StripeInvoicePaymentSucceededWebhookEvent;

        await handlePaymentSucceeded(
          dbAdapter,
          stripeInvoicePaymentSucceededEvent,
        );

        // Assert there are now three subscriptions and last one is active
        subscriptions = await fetchSubscriptionsByUserId(dbAdapter, user.id);
        assert.strictEqual(subscriptions.length, 3);
        assert.strictEqual(subscriptions[0].status, 'ended_due_to_plan_change');
        assert.strictEqual(subscriptions[1].status, 'ended_due_to_plan_change');
        assert.strictEqual(subscriptions[2].status, 'active');

        // Assert that subscriptions have correct plan ids
        assert.strictEqual(subscriptions[0].planId, freePlan.id);
        assert.strictEqual(subscriptions[1].planId, creatorPlan.id);
        assert.strictEqual(subscriptions[2].planId, powerUserPlan.id);

        // Assert that the new subscription has the correct period start and end
        assert.strictEqual(subscriptions[2].startedAt, 4);
        assert.strictEqual(subscriptions[2].endedAt, null);

        subscriptionCycles = await fetchSubscriptionCyclesBySubscriptionId(
          dbAdapter,
          subscriptions[2].id,
        );

        // Assert that latest subscription cycle has the correct period start and end
        assert.strictEqual(subscriptionCycles.length, 1);
        assert.strictEqual(subscriptionCycles[0].periodStart, 4);
        assert.strictEqual(subscriptionCycles[0].periodEnd, 5);

        let previousCreditsBalance = creditsBalance;

        creditsBalance = await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        });

        // Assert that the credits balance is the prorated amount for going from creator to power user plan
        let creditsToExpireforUnusedTimeOnPreviousPlan = Math.round(
          (amountCreditedForUnusedTimeOnPreviousPlan /
            (creatorPlan.monthlyPrice * 100)) *
            creatorPlan.creditsIncluded,
        );
        let creditsToAddForRemainingTime = Math.round(
          (amountCreditedForRemainingTimeOnNewPlan /
            (powerUserPlan.monthlyPrice * 100)) *
            powerUserPlan.creditsIncluded,
        );
        assert.strictEqual(
          creditsBalance,
          previousCreditsBalance -
            creditsToExpireforUnusedTimeOnPreviousPlan +
            creditsToAddForRemainingTime,
        );

        // Downgrade to creator plan
        stripeInvoicePaymentSucceededEvent = {
          id: 'evt_12345678901',
          object: 'event',
          type: 'invoice.payment_succeeded',
          data: {
            object: {
              id: 'in_1234567890',
              object: 'invoice',
              amount_paid: creatorPlan.monthlyPrice * 100,
              billing_reason: 'subscription_update',
              period_start: 5,
              period_end: 6,
              subscription: 'sub_1234567890',
              customer: 'cus_123',
              lines: {
                data: [
                  {
                    amount: creatorPlan.monthlyPrice * 100,
                    price: { product: 'prod_creator' },
                    period: { start: 5, end: 6 },
                  },
                ],
              },
            },
          },
        } as StripeInvoicePaymentSucceededWebhookEvent;

        await handlePaymentSucceeded(
          dbAdapter,
          stripeInvoicePaymentSucceededEvent,
        );

        // Assert there are now four subscriptions and last one is active
        subscriptions = await fetchSubscriptionsByUserId(dbAdapter, user.id);
        assert.strictEqual(subscriptions.length, 4);
        assert.strictEqual(subscriptions[0].status, 'ended_due_to_plan_change');
        assert.strictEqual(subscriptions[1].status, 'ended_due_to_plan_change');
        assert.strictEqual(subscriptions[2].status, 'ended_due_to_plan_change');
        assert.strictEqual(subscriptions[3].status, 'active');

        // Assert that subscriptions have correct plan ids
        assert.strictEqual(subscriptions[0].planId, freePlan.id);
        assert.strictEqual(subscriptions[1].planId, creatorPlan.id);
        assert.strictEqual(subscriptions[2].planId, powerUserPlan.id);
        assert.strictEqual(subscriptions[3].planId, creatorPlan.id);

        // Assert that the new subscription has the correct period start and end
        assert.strictEqual(subscriptions[3].startedAt, 5);
        assert.strictEqual(subscriptions[3].endedAt, null);

        subscriptionCycles = await fetchSubscriptionCyclesBySubscriptionId(
          dbAdapter,
          subscriptions[3].id,
        );

        // Assert that latest subscription cycle has the correct period start and end
        assert.strictEqual(subscriptionCycles.length, 1);
        assert.strictEqual(subscriptionCycles[0].periodStart, 5);
        assert.strictEqual(subscriptionCycles[0].periodEnd, 6);

        // Assert that user now has the plan's allowance (No proration will happen because Stripe assures us that downgrading to a cheaper plan will happen at the end of the billing period)
        // (This is a setting in Stripe's customer portal)
        creditsBalance = await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        });

        assert.strictEqual(creditsBalance, creatorPlan.creditsIncluded);

        // Now user switches back to free plan
        stripeInvoicePaymentSucceededEvent = {
          id: 'evt_123456789011',
          object: 'event',
          type: 'invoice.payment_succeeded',
          data: {
            object: {
              id: 'in_1234567890',
              object: 'invoice',
              amount_paid: 0,
              billing_reason: 'subscription_update',
              period_start: 1635873600,
              period_end: 1638465600,
              subscription: 'sub_1234567890',
              customer: 'cus_123',
              lines: {
                data: [
                  {
                    amount: 0,
                    price: { product: 'prod_free' },
                  },
                ],
              },
            },
          },
        } as StripeInvoicePaymentSucceededWebhookEvent;

        await handlePaymentSucceeded(
          dbAdapter,
          stripeInvoicePaymentSucceededEvent,
        );

        // Assert there are now 5 subscriptions and last one is active
        subscriptions = await fetchSubscriptionsByUserId(dbAdapter, user.id);
        assert.strictEqual(subscriptions.length, 5);
        assert.strictEqual(subscriptions[0].status, 'ended_due_to_plan_change');
        assert.strictEqual(subscriptions[1].status, 'ended_due_to_plan_change');
        assert.strictEqual(subscriptions[2].status, 'ended_due_to_plan_change');
        assert.strictEqual(subscriptions[3].status, 'ended_due_to_plan_change');
        assert.strictEqual(subscriptions[4].status, 'active');

        // Assert that subscriptions have correct plan ids
        assert.strictEqual(subscriptions[0].planId, freePlan.id);
        assert.strictEqual(subscriptions[1].planId, creatorPlan.id);
        assert.strictEqual(subscriptions[2].planId, powerUserPlan.id);
        assert.strictEqual(subscriptions[3].planId, creatorPlan.id);
        assert.strictEqual(subscriptions[4].planId, freePlan.id);

        creditsBalance = await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        });
        assert.strictEqual(creditsBalance, freePlan.creditsIncluded);
      });
    });

    module('subscription cycle', function () {
      test('renews the subscription', async function (assert) {
        let user = await insertUser(dbAdapter, 'user@test', 'cus_123');
        let plan = await insertPlan(
          dbAdapter,
          'Creator',
          12,
          2500,
          'prod_creator',
        );
        let subscription = await insertSubscription(dbAdapter, {
          user_id: user.id,
          plan_id: plan.id,
          started_at: 1,
          status: 'active',
          stripe_subscription_id: 'sub_1234567890',
        });
        let subscriptionCycle = await insertSubscriptionCycle(dbAdapter, {
          subscriptionId: subscription.id,
          periodStart: 1,
          periodEnd: 2,
        });

        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: plan.creditsIncluded,
          creditType: 'plan_allowance',
          subscriptionCycleId: subscriptionCycle.id,
        });

        // User spent 2000 credits in this cycle (from his plan allowance, which is 2500 credits)
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: -1000,
          creditType: 'plan_allowance_used',
          subscriptionCycleId: subscriptionCycle.id,
        });

        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: -1000,
          creditType: 'plan_allowance_used',
          subscriptionCycleId: subscriptionCycle.id,
        });

        // User added 100 additional credits in this cycle (even though user has some plan allowance left but for the sake of a more thorough test we want to simulate a purchase of extra credits)
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 100,
          creditType: 'extra_credit',
          subscriptionCycleId: subscriptionCycle.id,
        });

        // Next cycle
        let stripeInvoicePaymentSucceededEvent = {
          id: 'evt_1234567890',
          object: 'event',
          type: 'invoice.payment_succeeded',
          data: {
            object: {
              id: 'in_1234567890',
              object: 'invoice',
              amount_paid: 12,
              billing_reason: 'subscription_cycle',
              period_start: 2,
              period_end: 3,
              subscription: 'sub_1234567890',
              customer: 'cus_123',
              lines: {
                data: [
                  {
                    amount: 1200,
                    price: { product: 'prod_creator' },
                  },
                ],
              },
            },
          },
        } as StripeInvoicePaymentSucceededWebhookEvent;

        let availableCredits = await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        });
        assert.strictEqual(availableCredits, plan.creditsIncluded - 2000 + 100);

        await handlePaymentSucceeded(
          dbAdapter,
          stripeInvoicePaymentSucceededEvent,
        );

        // Assert that there are now two subscription cycles
        let subscriptionCycles = await fetchSubscriptionCyclesBySubscriptionId(
          dbAdapter,
          subscription.id,
        );
        assert.strictEqual(subscriptionCycles.length, 2);

        // Assert both subscription cycles have the correct period start and end
        assert.strictEqual(subscriptionCycles[0].periodStart, 1);
        assert.strictEqual(subscriptionCycles[0].periodEnd, 2);
        assert.strictEqual(subscriptionCycles[1].periodStart, 2);
        assert.strictEqual(subscriptionCycles[1].periodEnd, 3);

        // Assert that the ledger has the correct sum of credits going in and out
        availableCredits = await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        });
        assert.strictEqual(availableCredits, plan.creditsIncluded + 100); // Remaining credits from the previous cycle expired, new credits added, plus 100 from the extra credit
      });
    });
  });

  module('subscription deleted', function () {
    test('handles subscription cancellation', async function (assert) {
      let user = await insertUser(dbAdapter, 'user@test', 'cus_123');
      let plan = await insertPlan(
        dbAdapter,
        'Creator',
        12,
        2500,
        'prod_creator',
      );

      let subscription = await insertSubscription(dbAdapter, {
        user_id: user.id,
        plan_id: plan.id,
        started_at: 1,
        status: 'active',
        stripe_subscription_id: 'sub_1234567890',
      });

      await insertSubscriptionCycle(dbAdapter, {
        subscriptionId: subscription.id,
        periodStart: 1,
        periodEnd: 2,
      });

      let stripeSubscriptionDeletedEvent = {
        id: 'evt_sub_deleted_1',
        object: 'event',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_1234567890',
            canceled_at: 2,
            cancellation_details: {
              reason: 'cancellation_requested',
            },
          },
        },
      } as StripeSubscriptionDeletedWebhookEvent;

      await handleSubscriptionDeleted(
        dbAdapter,
        stripeSubscriptionDeletedEvent,
      );

      let subscriptions = await fetchSubscriptionsByUserId(dbAdapter, user.id);
      assert.strictEqual(subscriptions.length, 1);
      assert.strictEqual(subscriptions[0].status, 'canceled');
      assert.strictEqual(subscriptions[0].endedAt, 2);

      let availableCredits = await sumUpCreditsLedger(dbAdapter, {
        userId: user.id,
      });
      assert.strictEqual(availableCredits, 0);
    });
  });

  module('checkout session completed', function (hooks) {
    let user: User;

    hooks.beforeEach(async function () {
      user = await insertUser(dbAdapter, 'testuser', 'cus_123');
    });

    test('update user stripe customer id when checkout session completed', async function (assert) {
      let stripeCheckoutSessionCompletedEvent = {
        id: 'evt_1234567890',
        object: 'event',
        data: {
          object: {
            id: 'cs_test_1234567890',
            object: 'checkout.session',
            client_reference_id: 'testuser',
            customer: 'cus_123',
            metadata: {},
          },
        },
        type: 'checkout.session.completed',
      } as StripeCheckoutSessionCompletedWebhookEvent;

      await handleCheckoutSessionCompleted(
        dbAdapter,
        stripeCheckoutSessionCompletedEvent,
      );

      let stripeEvents = await fetchStripeEvents(dbAdapter);
      assert.strictEqual(stripeEvents.length, 1);
      assert.strictEqual(
        stripeEvents[0].stripe_event_id,
        stripeCheckoutSessionCompletedEvent.id,
      );

      const updatedUser = await fetchUserByStripeCustomerId(
        dbAdapter,
        'cus_123',
      );
      assert.strictEqual(updatedUser.length, 1);
      assert.strictEqual(updatedUser[0].stripe_customer_id, 'cus_123');
      assert.strictEqual(updatedUser[0].matrix_user_id, 'testuser');
    });

    test('add extra credits to user ledger when checkout session completed', async function (assert) {
      let stripeCheckoutSessionCompletedEvent = {
        id: 'evt_1234567890',
        object: 'event',
        data: {
          object: {
            id: 'cs_test_1234567890',
            object: 'checkout.session',
            customer: 'cus_123',
            metadata: {
              credit_reload_amount: '25000',
            },
          },
        },
        type: 'checkout.session.completed',
      } as StripeCheckoutSessionCompletedWebhookEvent;

      await handleCheckoutSessionCompleted(
        dbAdapter,
        stripeCheckoutSessionCompletedEvent,
      );

      let availableExtraCredits = await sumUpCreditsLedger(dbAdapter, {
        userId: user.id,
        creditType: 'extra_credit',
      });
      assert.strictEqual(availableExtraCredits, 25000);
    });
  });

  // eslint-disable-next-line qunit/no-only
  module.only('ai usage tracking', function (hooks) {
    let user: User;
    let creatorPlan: Plan;
    let subscription: Subscription;
    let subscriptionCycle: SubscriptionCycle;

    hooks.beforeEach(async function () {
      user = await insertUser(dbAdapter, 'testuser', 'cus_123');
      creatorPlan = await insertPlan(
        dbAdapter,
        'Creator',
        12,
        2500,
        'prod_creator',
      );
      subscription = await insertSubscription(dbAdapter, {
        user_id: user.id,
        plan_id: creatorPlan.id,
        started_at: 1,
        status: 'active',
        stripe_subscription_id: 'sub_1234567890',
      });
      subscriptionCycle = await insertSubscriptionCycle(dbAdapter, {
        subscriptionId: subscription.id,
        periodStart: 1,
        periodEnd: 2,
      });
    });

    test('spends ai credits correctly when no extra credits are available', async function (assert) {
      // User receives 2500 credits for the creator plan and spends 2490 credits
      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: creatorPlan.creditsIncluded,
        creditType: 'plan_allowance',
        subscriptionCycleId: subscriptionCycle.id,
      });

      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: -2490,
        creditType: 'plan_allowance_used',
        subscriptionCycleId: subscriptionCycle.id,
      });

      assert.strictEqual(
        await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        }),
        10,
      );

      await spendCredits(dbAdapter, user.id, 2);

      assert.strictEqual(
        await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        }),
        8,
      );

      await spendCredits(dbAdapter, user.id, 5);

      assert.strictEqual(
        await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        }),
        3,
      );

      // Make sure that we can't spend more credits than the user has - in this case user has 3 credits left and we try to spend 5
      await spendCredits(dbAdapter, user.id, 5);
      assert.strictEqual(
        await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        }),
        0,
      );
    });

    test('spends ai credits correctly when extra credits are available', async function (assert) {
      // User receives 2500 credits for the creator plan and spends 2490 credits
      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: creatorPlan.creditsIncluded,
        creditType: 'plan_allowance',
        subscriptionCycleId: subscriptionCycle.id,
      });

      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: -2490,
        creditType: 'plan_allowance_used',
        subscriptionCycleId: subscriptionCycle.id,
      });

      assert.strictEqual(
        await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        }),
        10,
      );

      // Add 5 extra credits
      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: 5,
        creditType: 'extra_credit',
        subscriptionCycleId: null,
      });

      // User has 15 credits in total: 10 credits from the plan allowance and 5 extra credits
      assert.strictEqual(
        await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        }),
        15,
      );

      // This should spend 10 credits from the plan allowance and 2 from the extra credits
      await spendCredits(dbAdapter, user.id, 12);

      // Plan allowance is now 0, 3 credits left from the extra credits
      assert.strictEqual(
        await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        }),
        3,
      );

      // Make sure the available credits come from the extra credits and not the plan allowance
      assert.strictEqual(
        await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
          creditType: ['plan_allowance', 'plan_allowance_used'],
        }),
        0,
      );

      assert.strictEqual(
        await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
          creditType: ['extra_credit', 'extra_credit_used'],
        }),
        3,
      );
    });
  });
});
