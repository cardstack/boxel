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

async function insertUser(
  dbAdapter: PgAdapter,
  matrixUserId: string,
  stripeCustomerId: string,
) {
  let { valueExpressions, nameExpressions: _nameExpressions } = asExpressions({
    matrix_user_id: matrixUserId,
    stripe_customer_id: stripeCustomerId,
  });
  let result = await query(dbAdapter, [
    `INSERT INTO users (matrix_user_id, stripe_customer_id) VALUES`,
    ...addExplicitParens(separatedByCommas(valueExpressions)),
    ` RETURNING *`,
  ] as Expression);

  return result[0];
}

async function insertPlan(
  dbAdapter: PgAdapter,
  name: string,
  monthlyPrice: number,
  creditsIncluded: number,
  stripePlanId: string,
) {
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

  return result[0];
}

async function fetchStripeEvents(dbAdapter: PgAdapter) {
  return await query(dbAdapter, [`SELECT * FROM stripe_events`]);
}

async function fetchSubscriptionsByUserId(
  dbAdapter: PgAdapter,
  userId: string,
) {
  return (await query(dbAdapter, [
    `SELECT * FROM subscriptions WHERE user_id = `,
    param(userId),
  ])) as {
    id: string;
    user_id: string;
    plan_id: string;
    started_at: string;
    ended_at: string;
    status: string;
    stripe_subscription_id: string;
  }[];
}

async function fetchSubscriptionCyclesBySubscriptionId(
  dbAdapter: PgAdapter,
  subscriptionId: string,
) {
  return await query(dbAdapter, [
    `SELECT * FROM subscription_cycles WHERE subscription_id = `,
    param(subscriptionId),
  ]);
}

async function fetchCreditsLedgerByUser(dbAdapter: PgAdapter, userId: string) {
  return await query(dbAdapter, [
    `SELECT * FROM credits_ledger WHERE user_id = `,
    param(userId),
  ]);
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
        test('creates a new subscription and adds plan allowance in credits', async function (assert) {
          let user = await insertUser(dbAdapter, 'user@test', 'cus_123');
          let plan = await insertPlan(
            dbAdapter,
            'Free plan',
            0,
            100,
            'prod_123',
          );

          // Omitted version of a real stripe invoice.paid event
          let stripeInvoicePaidEvent = {
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

          await handlePaymentSucceeded(dbAdapter, stripeInvoicePaidEvent);

          // Assert that the stripe event was inserted and processed
          let stripeEvents = await fetchStripeEvents(dbAdapter);
          assert.equal(stripeEvents.length, 1);
          assert.equal(
            stripeEvents[0].stripe_event_id,
            stripeInvoicePaidEvent.id,
          );
          assert.equal(stripeEvents[0].is_processed, true);

          // Assert that the subscription was created
          let subscriptions = await fetchSubscriptionsByUserId(
            dbAdapter,
            user.id,
          );
          assert.equal(subscriptions.length, 1);
          let subscription = subscriptions[0];

          assert.equal(subscription.user_id, user.id);
          assert.equal(subscription.plan_id, plan.id);
          assert.equal(subscription.status, 'active');
          assert.equal(subscription.stripe_subscription_id, 'sub_1234567890');

          // Assert that the subscription cycle was created
          let subscriptionCycles =
            await fetchSubscriptionCyclesBySubscriptionId(
              dbAdapter,
              subscription.id,
            );
          assert.equal(subscriptionCycles.length, 1);
          let subscriptionCycle = subscriptionCycles[0];

          assert.equal(subscriptionCycle.subscription_id, subscription.id);
          assert.equal(
            subscriptionCycle.period_start,
            stripeInvoicePaidEvent.data.object.period_start,
          );
          assert.equal(
            subscriptionCycle.period_end,
            stripeInvoicePaidEvent.data.object.period_end,
          );

          // Assert that the credits were added to the user's balance
          let creditsLedger = await fetchCreditsLedgerByUser(
            dbAdapter,
            user.id,
          );
          assert.equal(creditsLedger.length, 1);
          let creditLedgerEntry = creditsLedger[0];
          assert.equal(creditLedgerEntry.user_id, user.id);
          assert.equal(creditLedgerEntry.credit_amount, plan.credits_included);
          assert.equal(creditLedgerEntry.credit_type, 'plan_allowance');
          assert.equal(
            creditLedgerEntry.subscription_cycle_id,
            subscriptionCycle.id,
          );
        });
      },
    );
  });
});
