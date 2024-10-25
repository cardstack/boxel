import {
  Expression,
  addExplicitParens,
  asExpressions,
  param,
  query,
  separatedByCommas,
} from '@cardstack/runtime-common';
import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';
import PgAdapter from '../pg-adapter';
import { handlePaymentSucceeded } from '../billing/stripe-webhook-handlers/subscribe';
import {
  LedgerEntry,
  Plan,
  Subscription,
  SubscriptionCycle,
  User,
  insertSubscriptionCycle,
  sumUpCreditsLedger,
} from '../billing/billing_queries';
import { insertSubscription } from '../billing/billing_queries';
import { addToCreditsLedger } from '../billing/billing_queries';

async function insertUser(
  dbAdapter: PgAdapter,
  matrixUserId: string,
  stripeCustomerId: string,
): Promise<User> {
  let { valueExpressions, nameExpressions: _nameExpressions } = asExpressions({
    matrix_user_id: matrixUserId,
    stripe_customer_id: stripeCustomerId,
  });
  let result = await query(dbAdapter, [
    `INSERT INTO users (matrix_user_id, stripe_customer_id) VALUES`,
    ...addExplicitParens(separatedByCommas(valueExpressions)),
    ` RETURNING *`,
  ] as Expression);

  return {
    id: result[0].id as string,
    matrixUserId: result[0].matrix_user_id as string,
    stripeCustomerId: result[0].stripe_customer_id as string,
  };
}

async function insertPlan(
  dbAdapter: PgAdapter,
  name: string,
  monthlyPrice: number,
  creditsIncluded: number,
  stripePlanId: string,
): Promise<Plan> {
  let { valueExpressions, nameExpressions: _nameExpressions } = asExpressions({
    name,
    monthly_price: monthlyPrice,
    credits_included: creditsIncluded,
    stripe_plan_id: stripePlanId,
  });
  let result = await query(dbAdapter, [
    `INSERT INTO plans (name, monthly_price, credits_included, stripe_plan_id) VALUES`,
    ...addExplicitParens(separatedByCommas(valueExpressions)),
    ` RETURNING *`,
  ] as Expression);

  return {
    id: result[0].id as string,
    name: result[0].name as string,
    monthlyPrice: result[0].monthly_price as number,
    creditsIncluded: result[0].credits_included as number,
  };
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
    periodStart: result.period_start as number,
    periodEnd: result.period_end as number,
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

  return results.map((result) => ({
    id: result.id as string,
    userId: result.user_id as string,
    creditAmount: result.credit_amount as number,
    creditType: result.credit_type as string,
    subscriptionCycleId: result.subscription_cycle_id as string,
  }));
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

  module('invoice paid', function (hooks) {
    module(
      'new subscription without any previous subscription',
      function (hooks) {
        // eslint-disable-next-line
        test.only('creates a new subscription and adds plan allowance in credits', async function (assert) {
          let user = await insertUser(dbAdapter, 'user@test', 'cus_123');
          let plan = await insertPlan(
            dbAdapter,
            'Free plan',
            0,
            100,
            'prod_123',
          );

          // Omitted version of a real stripe invoice.paid event
          let stripeInvoicePaymentSucceededEvent = {
            id: 'evt_1234567890',
            object: 'event',
            type: 'invoice.paid',
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
                      plan: { product: 'prod_123' },
                    },
                  ],
                },
              },
            },
          };

          await handlePaymentSucceeded(
            dbAdapter,
            stripeInvoicePaymentSucceededEvent,
          );

          // Assert that the stripe event was inserted and processed
          let stripeEvents = await fetchStripeEvents(dbAdapter);
          assert.equal(stripeEvents.length, 1);
          assert.equal(
            stripeEvents[0].stripe_event_id,
            stripeInvoicePaymentSucceededEvent.id,
          );
          assert.equal(stripeEvents[0].is_processed, true);

          // Assert that the subscription was created
          let subscriptions = await fetchSubscriptionsByUserId(
            dbAdapter,
            user.id,
          );
          assert.equal(subscriptions.length, 1);
          let subscription = subscriptions[0];

          assert.equal(subscription.userId, user.id);
          assert.equal(subscription.planId, plan.id);
          assert.equal(subscription.status, 'active');
          assert.equal(subscription.stripeSubscriptionId, 'sub_1234567890');

          // Assert that the subscription cycle was created
          let subscriptionCycles =
            await fetchSubscriptionCyclesBySubscriptionId(
              dbAdapter,
              subscription.id,
            );
          assert.equal(subscriptionCycles.length, 1);
          let subscriptionCycle = subscriptionCycles[0];

          assert.equal(subscriptionCycle.subscriptionId, subscription.id);
          assert.equal(
            subscriptionCycle.periodStart,
            stripeInvoicePaymentSucceededEvent.data.object.period_start,
          );
          assert.equal(
            subscriptionCycle.periodEnd,
            stripeInvoicePaymentSucceededEvent.data.object.period_end,
          );

          // Assert that the credits were added to the user's balance
          let creditsLedger = await fetchCreditsLedgerByUser(
            dbAdapter,
            user.id,
          );
          assert.equal(creditsLedger.length, 1);
          let creditLedgerEntry = creditsLedger[0];
          assert.equal(creditLedgerEntry.userId, user.id);
          assert.equal(creditLedgerEntry.creditAmount, plan.creditsIncluded);
          assert.equal(creditLedgerEntry.creditType, 'plan_allowance');
          assert.equal(
            creditLedgerEntry.subscriptionCycleId,
            subscriptionCycle.id,
          );

          // Error if stripe event is processed again
          await assert.rejects(
            handlePaymentSucceeded(
              dbAdapter,
              stripeInvoicePaymentSucceededEvent,
            ),
            'error: duplicate key value violates unique constraint "stripe_events_pkey"',
          );
        });
      },
    );

    module('subscription cycle', function (hooks) {
      // eslint-disable-next-line
      test.only('renews the subscription', async function (assert) {
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

        await addToCreditsLedger(
          dbAdapter,
          user.id,
          plan.creditsIncluded,
          'plan_allowance',
          subscriptionCycle.id,
        );

        await addToCreditsLedger(
          dbAdapter,
          user.id,
          -5,
          'plan_allowance_used',
          subscriptionCycle.id,
        );

        await addToCreditsLedger(
          dbAdapter,
          user.id,
          -3,
          'plan_allowance_used',
          subscriptionCycle.id,
        );

        // User spent 8 credits in this cycle

        // Next cycle
        let stripeInvoicePaymentSucceededEvent = {
          id: 'evt_1234567890',
          object: 'event',
          type: 'invoice.paid',
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
                    plan: { product: 'prod_creator' },
                  },
                ],
              },
            },
          },
        };

        let availableCredits = await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        });
        assert.equal(availableCredits, plan.creditsIncluded - 5 - 3);

        await handlePaymentSucceeded(
          dbAdapter,
          stripeInvoicePaymentSucceededEvent,
        );

        // Assert that there are now two subscription cycles
        let subscriptionCycles = await fetchSubscriptionCyclesBySubscriptionId(
          dbAdapter,
          subscription.id,
        );
        assert.equal(subscriptionCycles.length, 2);

        // Assert both subscription cycles have the correct period start and end
        assert.equal(subscriptionCycles[0].periodStart, 1);
        assert.equal(subscriptionCycles[0].periodEnd, 2);
        assert.equal(subscriptionCycles[1].periodStart, 2);
        assert.equal(subscriptionCycles[1].periodEnd, 3);

        // Assert that the ledger has the correct sum of credits going in and out
        availableCredits = await sumUpCreditsLedger(dbAdapter, {
          userId: user.id,
        });
        assert.equal(availableCredits, plan.creditsIncluded);
      });
    });
  });
});
