import type {
  LedgerEntry,
  Plan,
  Subscription,
  SubscriptionCycle,
  User,
} from '@cardstack/runtime-common';
import {
  Deferred,
  logger,
  param,
  query,
  userInitiatedPrerenderHtmlPriority,
} from '@cardstack/runtime-common';
import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  fetchSubscriptionsByUserId,
  insertPlan,
  insertUser,
  prepareTestDB,
} from './helpers/index.ts';
import { PgQueueRunner, type PgAdapter } from '@cardstack/postgres';
import { handlePaymentSucceeded } from '@cardstack/billing/stripe-webhook-handlers/payment-succeeded';
import { handleSubscriptionDeleted } from '@cardstack/billing/stripe-webhook-handlers/subscription-deleted';
import { handleCheckoutSessionCompleted } from '@cardstack/billing/stripe-webhook-handlers/checkout-session-completed';
import {
  insertSubscriptionCycle,
  sumUpCreditsLedger,
  addToCreditsLedger,
  getLedgerEntries,
  insertSubscription,
  spendCredits,
} from '@cardstack/billing/billing-queries';
import { spendUsageCost } from '@cardstack/billing/ai-billing';
import type { TaskArgs } from '@cardstack/runtime-common/tasks';
import { dailyCreditGrant } from '@cardstack/runtime-common/tasks/daily-credit-grant';
import { enqueueDailyCreditGrant } from '../scripts/daily-credit-grant.ts';

import type {
  StripeInvoicePaymentSucceededWebhookEvent,
  StripeSubscriptionDeletedWebhookEvent,
  StripeCheckoutSessionCompletedWebhookEvent,
} from '@cardstack/billing/stripe-webhook-handlers';

import { basename } from 'path';

async function fetchStripeEvents(dbAdapter: PgAdapter) {
  return await query(dbAdapter, [`SELECT * FROM stripe_events`]);
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

function buildDailyCreditGrantTaskArgs(dbAdapter: PgAdapter): TaskArgs {
  return {
    dbAdapter,
    queuePublisher: {} as TaskArgs['queuePublisher'],
    indexWriter: {} as TaskArgs['indexWriter'],
    prerenderer: {} as TaskArgs['prerenderer'],
    definitionLookup: {} as TaskArgs['definitionLookup'],
    virtualNetwork: {} as TaskArgs['virtualNetwork'],
    log: logger('test-daily-credit-grant'),
    matrixURL: 'http://matrix.invalid',
    matrixServerName: 'localhost',
    getReader: () => {
      throw new Error('getReader should not be called in daily credit grant');
    },
    getAuthedFetch: async () => {
      throw new Error(
        'getAuthedFetch should not be called in daily credit grant',
      );
    },
    createPrerenderAuth: () => '',
    reportStatus: () => {},
  };
}

module(basename(import.meta.filename), function () {
  module('billing', function (hooks) {
    let dbAdapter: PgAdapter;

    hooks.beforeEach(async function () {
      prepareTestDB();
      dbAdapter = await createTestPgAdapter();
    });

    hooks.afterEach(async function () {
      await closeTestPgAdapter(dbAdapter);
    });

    module('invoice payment succeeded', function () {
      module('new subscription without any previous subscription', function () {
        test('creates a new subscription and adds plan allowance in credits', async function (assert) {
          let user = await insertUser(
            dbAdapter,
            'user@test',
            'cus_123',
            'user@test.com',
          );
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
                      type: 'subscription',
                      proration: false,
                      price: { product: 'prod_free' },
                      period: {
                        start: 1635873600,
                        end: 1638465600,
                      },
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
          assert.strictEqual(
            subscription.stripeSubscriptionId,
            'sub_1234567890',
          );

          // Assert that the subscription cycle was created
          let subscriptionCycles =
            await fetchSubscriptionCyclesBySubscriptionId(
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
          let creditsLedger = await fetchCreditsLedgerByUser(
            dbAdapter,
            user.id,
          );
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
            handlePaymentSucceeded(
              dbAdapter,
              stripeInvoicePaymentSucceededEvent,
            ),
            'error: duplicate key value violates unique constraint "stripe_events_pkey"',
          );
        });
      });

      module('subscription update', function () {
        test('updates the subscription and prorates credits', async function (assert) {
          let user = await insertUser(
            dbAdapter,
            'user@test',
            'cus_123',
            'user@test.com',
          );
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
                      type: 'subscription',
                      proration: false,
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
          assert.strictEqual(
            subscriptions[0].status,
            'ended_due_to_plan_change',
          );
          assert.ok(subscriptions[0].endedAt);

          // Assert that new subscription is active
          assert.strictEqual(subscriptions[1].status, 'active');

          // Assert that there is a new subscription cycle
          let subscriptionCycles =
            await fetchSubscriptionCyclesBySubscriptionId(
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

          // User received 5000 credits from the creator plan, but the 500 credits from the plan allowance they had left from the free plan were expired
          assert.strictEqual(creditsBalance, 5000);

          // User spent 2000 credits from the plan allowance
          await addToCreditsLedger(dbAdapter, {
            userId: user.id,
            creditAmount: -2000,
            creditType: 'plan_allowance_used',
            subscriptionCycleId: subscriptionCycle.id,
          });

          // Assert that the user now has 3000 credits left
          creditsBalance = await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
          });
          assert.strictEqual(creditsBalance, 3000);

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
                      type: 'subscription',
                      proration: false,
                      price: { product: 'prod_creator' },
                      period: { start: 3, end: 4 },
                    },
                    {
                      amount: amountCreditedForRemainingTimeOnNewPlan,
                      description: 'Remaining time on Power User plan',
                      type: 'subscription',
                      proration: false,
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
          assert.strictEqual(
            subscriptions[0].status,
            'ended_due_to_plan_change',
          );
          assert.strictEqual(
            subscriptions[1].status,
            'ended_due_to_plan_change',
          );
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
                      type: 'subscription',
                      proration: false,
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
          assert.strictEqual(
            subscriptions[0].status,
            'ended_due_to_plan_change',
          );
          assert.strictEqual(
            subscriptions[1].status,
            'ended_due_to_plan_change',
          );
          assert.strictEqual(
            subscriptions[2].status,
            'ended_due_to_plan_change',
          );
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
                      type: 'subscription',
                      proration: false,
                      price: { product: 'prod_free' },
                      period: {
                        start: 1635873600,
                        end: 1638465600,
                      },
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
          assert.strictEqual(
            subscriptions[0].status,
            'ended_due_to_plan_change',
          );
          assert.strictEqual(
            subscriptions[1].status,
            'ended_due_to_plan_change',
          );
          assert.strictEqual(
            subscriptions[2].status,
            'ended_due_to_plan_change',
          );
          assert.strictEqual(
            subscriptions[3].status,
            'ended_due_to_plan_change',
          );
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
          let user = await insertUser(
            dbAdapter,
            'user@test',
            'cus_123',
            'user@test.com',
          );
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
                      type: 'subscription',
                      proration: false,
                      price: { product: 'prod_creator' },
                      period: {
                        start: 20,
                        end: 30,
                      },
                    },
                  ],
                },
              },
            },
          } as StripeInvoicePaymentSucceededWebhookEvent;

          let availableCredits = await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
          });
          assert.strictEqual(
            availableCredits,
            plan.creditsIncluded - 2000 + 100,
          );

          await handlePaymentSucceeded(
            dbAdapter,
            stripeInvoicePaymentSucceededEvent,
          );

          // Assert that there are now two subscription cycles
          let subscriptionCycles =
            await fetchSubscriptionCyclesBySubscriptionId(
              dbAdapter,
              subscription.id,
            );
          assert.strictEqual(subscriptionCycles.length, 2);

          // Assert both subscription cycles have the correct period start and end
          assert.strictEqual(subscriptionCycles[0].periodStart, 1);
          assert.strictEqual(subscriptionCycles[0].periodEnd, 2);
          assert.strictEqual(subscriptionCycles[1].periodStart, 20);
          assert.strictEqual(subscriptionCycles[1].periodEnd, 30);

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
        let user = await insertUser(
          dbAdapter,
          'user@test',
          'cus_123',
          'user@test.com',
        );
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

        let subscriptions = await fetchSubscriptionsByUserId(
          dbAdapter,
          user.id,
        );
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
      let matrixUserId = '@pepe:cardstack.com';

      hooks.beforeEach(async function () {
        user = await insertUser(
          dbAdapter,
          matrixUserId,
          'cus_123',
          'user@test.com',
        );
      });

      module('user has a subscription', function () {
        test('add extra credits to user ledger when checkout session completed', async function (assert) {
          let creatorPlan = await insertPlan(
            dbAdapter,
            'Creator',
            12,
            2500,
            'prod_creator',
          );
          let subscription = await insertSubscription(dbAdapter, {
            user_id: user.id,
            plan_id: creatorPlan.id,
            started_at: 1,
            status: 'active',
            stripe_subscription_id: 'sub_1234567890',
          });
          await insertSubscriptionCycle(dbAdapter, {
            subscriptionId: subscription.id,
            periodStart: 1,
            periodEnd: 2,
          });
          let stripeCheckoutSessionCompletedEvent = {
            id: 'evt_1234567890',
            object: 'event',
            data: {
              object: {
                id: 'cs_test_1234567890',
                object: 'checkout.session',
                customer: null,

                metadata: {
                  credit_reload_amount: '25000',
                  user_id: user.id,
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

      module('user does not have a subscription', function () {
        test('add extra credits to user ledger when checkout session completed', async function (assert) {
          let stripeCheckoutSessionCompletedEvent = {
            id: 'evt_1234567890',
            object: 'event',
            data: {
              object: {
                id: 'cs_test_1234567890',
                object: 'checkout.session',
                customer: null,
                metadata: {
                  user_id: user.id,
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
    });

    module('AI usage tracking', function (hooks) {
      let user: User;
      let creatorPlan: Plan;
      let subscription: Subscription;
      let subscriptionCycle: SubscriptionCycle;

      hooks.beforeEach(async function () {
        user = await insertUser(
          dbAdapter,
          'testuser',
          'cus_123',
          'user@test.com',
        );
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

      test('does not spend previous cycle plan allowance in current cycle', async function (assert) {
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 100,
          creditType: 'plan_allowance',
          subscriptionCycleId: subscriptionCycle.id,
        });

        let nextSubscriptionCycle = await insertSubscriptionCycle(dbAdapter, {
          subscriptionId: subscription.id,
          periodStart: 2,
          periodEnd: 3,
        });
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 50,
          creditType: 'plan_allowance',
          subscriptionCycleId: nextSubscriptionCycle.id,
        });

        await spendCredits(dbAdapter, user.id, 80);

        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            subscriptionCycleId: subscriptionCycle.id,
            creditType: [
              'plan_allowance',
              'plan_allowance_used',
              'plan_allowance_expired',
            ],
          }),
          100,
        );
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            subscriptionCycleId: nextSubscriptionCycle.id,
            creditType: [
              'plan_allowance',
              'plan_allowance_used',
              'plan_allowance_expired',
            ],
          }),
          0,
        );
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
            creditType: [
              'plan_allowance',
              'plan_allowance_used',
              'plan_allowance_expired',
            ],
          }),
          100,
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

      test('spends ai credits using daily credits before extra credits', async function (assert) {
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 5,
          creditType: 'plan_allowance',
          subscriptionCycleId: subscriptionCycle.id,
        });
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 4,
          creditType: 'daily_credit',
          subscriptionCycleId: null,
        });
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 3,
          creditType: 'extra_credit',
          subscriptionCycleId: null,
        });

        await spendCredits(dbAdapter, user.id, 10);

        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
            creditType: [
              'plan_allowance',
              'plan_allowance_used',
              'plan_allowance_expired',
            ],
          }),
          0,
        );
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
            creditType: ['daily_credit', 'daily_credit_used'],
          }),
          0,
        );
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
            creditType: ['extra_credit', 'extra_credit_used'],
          }),
          2,
        );
      });
    });

    module('AI usage tracking without subscription', function (hooks) {
      let user: User;

      hooks.beforeEach(async function () {
        user = await insertUser(
          dbAdapter,
          'free-user',
          'cus_free',
          'free-user@test.com',
        );
      });

      test('spends daily credits before extra credits on free plan', async function (assert) {
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 4,
          creditType: 'daily_credit',
          subscriptionCycleId: null,
        });
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 3,
          creditType: 'extra_credit',
          subscriptionCycleId: null,
        });

        await spendCredits(dbAdapter, user.id, 5);

        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
            creditType: ['daily_credit', 'daily_credit_used'],
          }),
          0,
        );
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
            creditType: ['extra_credit', 'extra_credit_used'],
          }),
          2,
        );
      });
    });

    module('ledger charges', function (hooks) {
      let user: User;
      const realm = 'http://test-realm/ledger/';
      const runId = '6f1c1b1e-1b7a-4d5e-9b5f-6f0a3d1c2b10';
      const otherRunId = '0a8e3c55-2f0d-4c1c-8f6b-3e5b2a7d9c41';
      const pricingVersion = 'pv-test-1';

      hooks.beforeEach(async function () {
        user = await insertUser(
          dbAdapter,
          '@ledger:localhost',
          'cus_ledger',
          'ledger@test.com',
        );
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 1000,
          creditType: 'extra_credit',
          subscriptionCycleId: null,
        });
      });

      test('an AI charge records kind ai, with its realm and run when given', async function (assert) {
        await spendUsageCost(dbAdapter, user.matrixUserId, 0.002);
        await spendUsageCost(dbAdapter, user.matrixUserId, 0.003, {
          kind: 'ai',
          realm,
          runId,
        });

        let entries = await getLedgerEntries(dbAdapter, {
          userId: user.id,
          chargeKind: 'ai',
        });
        assert.deepEqual(
          entries
            .map((e) => [e.creditAmount, e.realm, e.runId])
            .sort((a, b) => (b[0] as number) - (a[0] as number)),
          [
            [-2, null, null],
            [-3, realm, runId],
          ],
        );
        assert.deepEqual(
          (await getLedgerEntries(dbAdapter, { runId })).map(
            (e) => e.chargeKind,
          ),
          ['ai'],
          'a run reads back its AI charge by reference',
        );
      });

      test('AI charges for the same run each write', async function (assert) {
        await spendCredits(dbAdapter, user.id, 5, {
          kind: 'ai',
          realm,
          runId,
        });
        await spendCredits(dbAdapter, user.id, 5, {
          kind: 'ai',
          realm,
          runId,
        });
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, { userId: user.id }),
          990,
        );
      });

      test('each consumption kind records its realm, reference and pricing version', async function (assert) {
        await spendCredits(dbAdapter, user.id, 10, {
          kind: 'run',
          realm,
          runId,
          pricingVersion,
        });
        await spendCredits(dbAdapter, user.id, 20, {
          kind: 'run_indexing',
          realm,
          runId,
          pricingVersion,
        });
        await spendCredits(dbAdapter, user.id, 30, {
          kind: 'batched_ai',
          realm,
          runId,
          batchId: 'batch_abc',
        });
        await spendCredits(dbAdapter, user.id, 40, {
          kind: 'storage',
          realm,
          automationId: 'http://test-realm/ledger/Automation/sync',
          day: '2026-11-10',
          pricingVersion,
        });

        let entries = await getLedgerEntries(dbAdapter, { realm });
        let byKind = Object.fromEntries(entries.map((e) => [e.chargeKind, e]));
        assert.deepEqual(Object.keys(byKind).sort(), [
          'batched_ai',
          'run',
          'run_indexing',
          'storage',
        ]);
        assert.deepEqual(
          [
            byKind.run.creditAmount,
            byKind.run.runId,
            byKind.run.pricingVersion,
          ],
          [-10, runId, pricingVersion],
        );
        assert.deepEqual(
          [byKind.run_indexing.creditAmount, byKind.run_indexing.runId],
          [-20, runId],
        );
        assert.deepEqual(
          [
            byKind.batched_ai.creditAmount,
            byKind.batched_ai.runId,
            byKind.batched_ai.batchId,
            byKind.batched_ai.pricingVersion,
          ],
          [-30, runId, 'batch_abc', null],
        );
        assert.deepEqual(
          [
            byKind.storage.creditAmount,
            byKind.storage.runId,
            byKind.storage.automationId,
            byKind.storage.chargeDay,
            byKind.storage.pricingVersion,
          ],
          [
            -40,
            null,
            'http://test-realm/ledger/Automation/sync',
            '2026-11-10',
            pricingVersion,
          ],
        );
        assert.deepEqual(
          (await getLedgerEntries(dbAdapter, { runId }))
            .map((e) => e.chargeKind)
            .sort(),
          ['batched_ai', 'run', 'run_indexing'],
          "a run's charges read back by its reference",
        );
        assert.deepEqual(
          (
            await getLedgerEntries(dbAdapter, {
              automationId: 'http://test-realm/ledger/Automation/sync',
              chargeDay: '2026-11-10',
            })
          ).map((e) => e.chargeKind),
          ['storage'],
        );
      });

      test('a charge with the same kind and reference writes once', async function (assert) {
        let charge = {
          kind: 'run' as const,
          realm,
          runId,
          pricingVersion,
        };
        assert.true(await spendCredits(dbAdapter, user.id, 25, charge));
        assert.false(
          await spendCredits(dbAdapter, user.id, 25, charge),
          'the retry reports the charge as already written',
        );
        assert.false(
          await spendCredits(dbAdapter, user.id, 99, {
            ...charge,
            pricingVersion: 'pv-other',
          }),
          'the identity is the kind and reference, not the amount or price',
        );
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, { userId: user.id }),
          975,
        );

        // Another kind or another reference is another charge.
        assert.true(
          await spendCredits(dbAdapter, user.id, 5, {
            ...charge,
            kind: 'run_indexing',
          }),
        );
        assert.true(
          await spendCredits(dbAdapter, user.id, 5, {
            ...charge,
            runId: otherRunId,
          }),
        );
        assert.true(
          await spendCredits(dbAdapter, user.id, 5, {
            kind: 'batched_ai',
            realm,
            runId,
            batchId: 'batch_1',
          }),
        );
        assert.true(
          await spendCredits(dbAdapter, user.id, 5, {
            kind: 'batched_ai',
            realm,
            runId,
            batchId: 'batch_2',
          }),
        );
        assert.false(
          await spendCredits(dbAdapter, user.id, 5, {
            kind: 'batched_ai',
            realm,
            runId,
            batchId: 'batch_1',
          }),
        );
        let storage = {
          kind: 'storage' as const,
          realm,
          automationId: 'http://test-realm/ledger/Automation/sync',
          day: '2026-11-10',
          pricingVersion,
        };
        assert.true(await spendCredits(dbAdapter, user.id, 5, storage));
        assert.true(
          await spendCredits(dbAdapter, user.id, 5, {
            ...storage,
            day: '2026-11-11',
          }),
        );
        assert.false(await spendCredits(dbAdapter, user.id, 5, storage));
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, { userId: user.id }),
          945,
        );
      });

      test('concurrent writers of one charge write it once', async function (assert) {
        let charge = {
          kind: 'run' as const,
          realm,
          runId,
          pricingVersion,
        };
        let results = await Promise.all(
          Array.from({ length: 5 }, () =>
            spendCredits(dbAdapter, user.id, 10, charge),
          ),
        );
        assert.strictEqual(results.filter(Boolean).length, 1);
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, { userId: user.id }),
          990,
        );
      });

      test('a charge that draws on several buckets writes all its rows once', async function (assert) {
        let plan = await insertPlan(
          dbAdapter,
          'Creator',
          12,
          2500,
          'prod_ledger',
        );
        let subscription = await insertSubscription(dbAdapter, {
          user_id: user.id,
          plan_id: plan.id,
          started_at: 1,
          status: 'active',
          stripe_subscription_id: 'sub_ledger',
        });
        let cycle = await insertSubscriptionCycle(dbAdapter, {
          subscriptionId: subscription.id,
          periodStart: 1,
          periodEnd: 2,
        });
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 30,
          creditType: 'plan_allowance',
          subscriptionCycleId: cycle.id,
        });
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 20,
          creditType: 'daily_credit',
          subscriptionCycleId: null,
        });

        let charge = {
          kind: 'run' as const,
          realm,
          runId,
          pricingVersion,
        };
        assert.true(await spendCredits(dbAdapter, user.id, 100, charge));
        assert.false(await spendCredits(dbAdapter, user.id, 100, charge));

        let entries = await getLedgerEntries(dbAdapter, { runId });
        assert.deepEqual(
          entries.map((e) => [e.creditType, e.creditAmount]).sort(),
          [
            ['daily_credit_used', -20],
            ['extra_credit_used', -50],
            ['plan_allowance_used', -30],
          ],
        );
        assert.true(
          entries.every((e) => e.chargeKind === 'run' && e.realm === realm),
          'every row of the charge carries its kind and reference',
        );
      });

      test('entries written without a kind read the kind their credit type implies', async function (assert) {
        let cycle = await insertSubscriptionCycle(dbAdapter, {
          subscriptionId: (
            await insertSubscription(dbAdapter, {
              user_id: user.id,
              plan_id: (
                await insertPlan(dbAdapter, 'Starter', 0, 100, 'prod_old')
              ).id,
              started_at: 1,
              status: 'expired',
              stripe_subscription_id: 'sub_old',
            })
          ).id,
          periodStart: 1,
          periodEnd: 2,
        });
        let rows: [string, number, string | null][] = [
          ['plan_allowance', 100, cycle.id],
          ['plan_allowance_used', -10, cycle.id],
          ['plan_allowance_expired', -90, cycle.id],
          ['daily_credit', 20, null],
          ['daily_credit_used', -5, null],
          ['extra_credit_used', -7, null],
        ];
        for (let [creditType, amount, cycleId] of rows) {
          await query(dbAdapter, [
            `INSERT INTO credits_ledger (user_id, credit_amount, credit_type, subscription_cycle_id) VALUES (`,
            param(user.id),
            `,`,
            param(amount),
            `,`,
            param(creditType),
            `,`,
            param(cycleId),
            `)`,
          ]);
        }
        await query(dbAdapter, [
          `UPDATE credits_ledger SET charge_kind = NULL WHERE user_id = `,
          param(user.id),
        ]);

        let kinds = Object.fromEntries(
          (await getLedgerEntries(dbAdapter, { userId: user.id })).map((e) => [
            e.creditType,
            e.chargeKind,
          ]),
        );
        assert.deepEqual(kinds, {
          plan_allowance: 'grant',
          plan_allowance_used: 'ai',
          plan_allowance_expired: 'expiry',
          daily_credit: 'grant',
          daily_credit_used: 'ai',
          extra_credit: 'purchase',
          extra_credit_used: 'ai',
        });
        assert.deepEqual(
          (
            await getLedgerEntries(dbAdapter, {
              userId: user.id,
              chargeKind: 'ai',
            })
          )
            .map((e) => e.creditAmount)
            .sort((a, b) => a - b),
          [-10, -7, -5],
          'spends without a kind are found by kind ai',
        );
      });

      test('credit writers record grants, purchases and expiries', async function (assert) {
        let task = dailyCreditGrant(buildDailyCreditGrantTaskArgs(dbAdapter));
        let poorUser = await insertUser(
          dbAdapter,
          '@ledger-poor:localhost',
          'cus_ledger_poor',
          'ledger-poor@test.com',
        );
        await task({ lowCreditThreshold: 10 });

        let stored = await query(dbAdapter, [
          `SELECT credit_type, charge_kind FROM credits_ledger WHERE user_id IN (`,
          param(user.id),
          `,`,
          param(poorUser.id),
          `) ORDER BY credit_type::text`,
        ]);
        assert.deepEqual(
          stored.map((r) => [r.credit_type, r.charge_kind]),
          [
            ['daily_credit', 'grant'],
            ['extra_credit', 'purchase'],
          ],
          'the kind is stored, not only derived when read',
        );
      });

      test('the database refuses a charge without the reference its kind needs', async function (assert) {
        let attempts: [string, Record<string, string | null>][] = [
          [
            'run without a run',
            { charge_kind: 'run', realm, pricing_version: pricingVersion },
          ],
          [
            'run without a pricing version',
            { charge_kind: 'run', realm, run_id: runId },
          ],
          [
            'storage without a day',
            {
              charge_kind: 'storage',
              realm,
              automation_id: 'a',
              pricing_version: pricingVersion,
            },
          ],
          [
            'batched AI without a batch',
            { charge_kind: 'batched_ai', realm, run_id: runId },
          ],
          ['a grant with a realm', { charge_kind: 'grant', realm }],
          ['an unknown kind', { charge_kind: 'refund' }],
        ];
        for (let [label, columns] of attempts) {
          let names = Object.keys(columns);
          try {
            await query(dbAdapter, [
              `INSERT INTO credits_ledger (user_id, credit_amount, credit_type, ${names.join(', ')}) VALUES (`,
              param(user.id),
              `, -1, 'extra_credit_used'`,
              ...names.flatMap((n) => [`,`, param(columns[n])]),
              `)`,
            ]);
            assert.ok(false, `${label} was accepted`);
          } catch (e) {
            assert.true(
              /credits_ledger_charge_reference_check/.test(String(e)),
              `${label} is refused: ${e}`,
            );
          }
        }
      });

      test('the database refuses a second row for the same charge and bucket', async function (assert) {
        await spendCredits(dbAdapter, user.id, 5, {
          kind: 'run',
          realm,
          runId,
          pricingVersion,
        });
        try {
          await query(dbAdapter, [
            `INSERT INTO credits_ledger (user_id, credit_amount, credit_type, charge_kind, realm, run_id, pricing_version) VALUES (`,
            param(user.id),
            `, -5, 'extra_credit_used', 'run',`,
            param(realm),
            `,`,
            param(runId),
            `,`,
            param(pricingVersion),
            `)`,
          ]);
          assert.ok(false, 'the duplicate was accepted');
        } catch (e) {
          assert.true(
            /credits_ledger_charge_once_idx/.test(String(e)),
            `the duplicate is refused: ${e}`,
          );
        }
      });
    });

    module('daily credit grant', function () {
      test('is claimed by a high-priority worker', async function (assert) {
        // The high-priority pool is the one a full reindex never occupies, so
        // a grant it can claim doesn't wait behind one.
        await enqueueDailyCreditGrant({ lowCreditThreshold: 10 });

        let claimed = new Deferred<void>();
        let worker = new PgQueueRunner({
          adapter: dbAdapter,
          workerId: 'high-priority-worker',
          priority: userInitiatedPrerenderHtmlPriority,
        });
        worker.register('daily-credit-grant', async () => {
          claimed.fulfill();
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = new Promise<'timed out'>((resolve) => {
          timer = setTimeout(() => resolve('timed out'), 10_000);
        });
        try {
          await worker.start();
          let outcome = await Promise.race([
            claimed.promise.then(() => 'claimed' as const),
            timedOut,
          ]);
          assert.strictEqual(outcome, 'claimed');
        } finally {
          clearTimeout(timer);
          await worker.destroy();
        }
      });

      test('grants credits when user falls below the threshold', async function (assert) {
        let user = await insertUser(
          dbAdapter,
          'low-credits@test',
          'cus_low',
          'low@test.com',
        );
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 3,
          creditType: 'extra_credit',
          subscriptionCycleId: null,
        });

        let task = dailyCreditGrant(buildDailyCreditGrantTaskArgs(dbAdapter));
        await task({ lowCreditThreshold: 10 });

        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
            creditType: ['daily_credit', 'daily_credit_used'],
          }),
          7,
        );
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
          }),
          10,
        );
      });

      test('does not grant twice on the same day', async function (assert) {
        let user = await insertUser(
          dbAdapter,
          'repeat@test',
          'cus_repeat',
          'repeat@test.com',
        );
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 2,
          creditType: 'extra_credit',
          subscriptionCycleId: null,
        });

        let task = dailyCreditGrant(buildDailyCreditGrantTaskArgs(dbAdapter));
        await task({ lowCreditThreshold: 10 });
        await task({ lowCreditThreshold: 10 });

        let ledgerEntries = await fetchCreditsLedgerByUser(dbAdapter, user.id);
        let dailyGrants = ledgerEntries.filter(
          (entry) => entry.creditType === 'daily_credit',
        );
        assert.strictEqual(dailyGrants.length, 1);
      });

      test('does not grant when user already meets threshold', async function (assert) {
        let user = await insertUser(
          dbAdapter,
          'enough-credits@test',
          'cus_enough',
          'enough@test.com',
        );
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: 10,
          creditType: 'extra_credit',
          subscriptionCycleId: null,
        });

        let task = dailyCreditGrant(buildDailyCreditGrantTaskArgs(dbAdapter));
        await task({ lowCreditThreshold: 10 });

        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
            creditType: ['daily_credit', 'daily_credit_used'],
          }),
          0,
        );
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            userId: user.id,
          }),
          10,
        );
      });
    });
  });
});
