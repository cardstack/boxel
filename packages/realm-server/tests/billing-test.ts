import { asExpressions, insert, param, query } from '@cardstack/runtime-common';
import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';
import PgAdapter from '../pg-adapter';
import { handlePaymentSucceeded } from '../billing/stripe-webhook-handlers/payment-succeeded';
import { handleSubscriptionDeleted } from '../billing/stripe-webhook-handlers/subscription-deleted';
import {
  LedgerEntry,
  Plan,
  Subscription,
  SubscriptionCycle,
  User,
  insertSubscriptionCycle,
  sumUpCreditsLedger,
  addToCreditsLedger,
  insertSubscription,
} from '../billing/billing-queries';

import {
  StripeInvoicePaymentSucceededWebhookEvent,
  StripeSubscriptionDeletedWebhookEvent,
} from '../billing/stripe-webhook-handlers';

async function insertUser(
  dbAdapter: PgAdapter,
  matrixUserId: string,
  stripeCustomerId: string,
): Promise<User> {
  let { valueExpressions, nameExpressions } = asExpressions({
    matrix_user_id: matrixUserId,
    stripe_customer_id: stripeCustomerId,
  });
  let result = await query(
    dbAdapter,
    insert('users', nameExpressions, valueExpressions),
  );

  return {
    id: result[0].id,
    matrixUserId: result[0].matrix_user_id,
    stripeCustomerId: result[0].stripe_customer_id,
  } as User;
}

async function insertPlan(
  dbAdapter: PgAdapter,
  name: string,
  monthlyPrice: number,
  creditsIncluded: number,
  stripePlanId: string,
): Promise<Plan> {
  let { valueExpressions, nameExpressions: nameExpressions } = asExpressions({
    name,
    monthly_price: monthlyPrice,
    credits_included: creditsIncluded,
    stripe_plan_id: stripePlanId,
  });
  let result = await query(
    dbAdapter,
    insert('plans', nameExpressions, valueExpressions),
  );
  return {
    id: result[0].id,
    name: result[0].name,
    monthlyPrice: result[0].monthly_price,
    creditsIncluded: result[0].credits_included,
    stripePlanId: result[0].stripe_plan_id,
  } as Plan;
}

async function fetchStripeEvents(dbAdapter: PgAdapter) {
  return await query(dbAdapter, [`SELECT * FROM stripe_events`]);
}

async function fetchSubscriptionsByUserId(
  dbAdapter: PgAdapter,
  userId: string,
): Promise<Subscription[]> {
  let results = (await query(dbAdapter, [
    `SELECT * FROM subscriptions WHERE user_id = `,
    param(userId),
  ])) as {
    id: string;
    user_id: string;
    plan_id: string;
    started_at: number;
    ended_at: number;
    status: string;
    stripe_subscription_id: string;
  }[];

  return results.map((result) => ({
    id: result.id,
    userId: result.user_id,
    planId: result.plan_id,
    startedAt: result.started_at,
    endedAt: result.ended_at,
    status: result.status,
    stripeSubscriptionId: result.stripe_subscription_id,
  }));
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
    dbAdapter = new PgAdapter();
  });

  hooks.afterEach(async function () {
    await dbAdapter.close();
  });

  module('invoice payment succeeded', function () {
    module('new subscription without any previous subscription', function () {
      test('creates a new subscription and adds plan allowance in credits', async function (assert) {
        let user = await insertUser(dbAdapter, 'user@test', 'cus_123');
        let plan = await insertPlan(dbAdapter, 'Free plan', 0, 100, 'prod_123');

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
                    price: { product: 'prod_123' },
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
    test('handles subscription cancellation and expiration', async function (assert) {
      let user = await insertUser(dbAdapter, 'user@test', 'cus_123');
      let plan = await insertPlan(
        dbAdapter,
        'Creator',
        12,
        2500,
        'prod_creator',
      );

      await insertSubscription(dbAdapter, {
        user_id: user.id,
        plan_id: plan.id,
        started_at: 1,
        status: 'active',
        stripe_subscription_id: 'sub_1234567890',
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
    });
  });
});
