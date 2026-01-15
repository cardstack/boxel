import { module, test } from 'qunit';
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { Realm } from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import Stripe from 'stripe';
import sinon from 'sinon';
import { getStripe } from '@cardstack/billing/stripe-webhook-handlers/stripe';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createJWT,
  fetchSubscriptionsByUserId,
  insertPlan,
  insertUser,
  realmSecretSeed,
  realmServerTestMatrix,
  setupPermissionedRealm,
} from '../helpers';
import { createRealmServerSession } from './helpers';
import { APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  MatrixEvent,
  RealmServerEventContent,
} from 'https://cardstack.com/base/matrix-event';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('Realm Server Endpoints (not specific to one realm)', function () {
    module('stripe webhook handler', function (hooks) {
      let testRealm: Realm;
      let request: SuperTest<Test>;
      let dbAdapter: PgAdapter;
      let createSubscriptionStub: sinon.SinonStub;
      let fetchPriceListStub: sinon.SinonStub;
      let matrixClient: MatrixClient;
      let roomId: string;
      let userId = '@test_realm:localhost';
      let waitForBillingNotification = async function (
        assert: Assert,
        done: () => void,
      ) {
        let messages = await matrixClient.roomMessages(roomId);
        let firstMessageContent = messages[0].content;

        if (messageEventContentIsRealmServerEvent(firstMessageContent)) {
          assert.strictEqual(
            (firstMessageContent as RealmServerEventContent).body,
            JSON.stringify({ eventType: 'billing-notification' }),
          );
          done();
        } else {
          setTimeout(() => waitForBillingNotification(assert, done), 1);
        }
      };

      function onRealmSetup(args: {
        testRealm: Realm;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
        testRealm = args.testRealm;
        request = args.request;
        dbAdapter = args.dbAdapter;
      }

      setupPermissionedRealm(hooks, {
        permissions: {
          '*': ['read', 'write'],
        },
        onRealmSetup,
      });

      hooks.beforeEach(async function () {
        let stripe = getStripe();
        createSubscriptionStub = sinon.stub(stripe.subscriptions, 'create');
        fetchPriceListStub = sinon.stub(stripe.prices, 'list');

        matrixClient = new MatrixClient({
          matrixURL: realmServerTestMatrix.url,
          username: 'test_realm',
          seed: realmSecretSeed,
        });
        await matrixClient.login();
        let { sessionRoom } = await createRealmServerSession(
          matrixClient,
          request,
        );

        let { joined_rooms: rooms } = await matrixClient.getJoinedRooms();

        if (!rooms.includes(sessionRoom)) {
          await matrixClient.joinRoom(sessionRoom);
        }

        roomId = sessionRoom;
      });

      hooks.afterEach(async function () {
        createSubscriptionStub.restore();
        fetchPriceListStub.restore();
      });

      test('subscribes user back to free plan when the current subscription is expired', async function (assert) {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        let user = await insertUser(
          dbAdapter,
          userId,
          'cus_123',
          'user@test.com',
        );
        let freePlan = await insertPlan(
          dbAdapter,
          'Free plan',
          0,
          100,
          'prod_free',
        );
        let creatorPlan = await insertPlan(
          dbAdapter,
          'Creator',
          12,
          5000,
          'prod_creator',
        );

        if (!secret) {
          throw new Error('STRIPE_WEBHOOK_SECRET is not set');
        }
        let stripeInvoicePaymentSucceededEvent = {
          id: 'evt_1234567890',
          object: 'event',
          type: 'invoice.payment_succeeded',
          data: {
            object: {
              id: 'in_1234567890',
              object: 'invoice',
              amount_paid: 12,
              billing_reason: 'subscription_create',
              period_end: 1638465600,
              period_start: 1635873600,
              subscription: 'sub_1234567890',
              customer: 'cus_123',
              lines: {
                data: [
                  {
                    amount: 12,
                    price: { product: 'prod_creator' },
                  },
                ],
              },
            },
          },
        };

        let timestamp = Math.floor(Date.now() / 1000);
        let stripeInvoicePaymentSucceededPayload = JSON.stringify(
          stripeInvoicePaymentSucceededEvent,
        );
        let stripeInvoicePaymentSucceededSignature =
          Stripe.webhooks.generateTestHeaderString({
            payload: stripeInvoicePaymentSucceededPayload,
            secret,
            timestamp,
          });
        await request
          .post('/_stripe-webhook')
          .send(stripeInvoicePaymentSucceededPayload)
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('stripe-signature', stripeInvoicePaymentSucceededSignature);

        let subscriptions = await fetchSubscriptionsByUserId(
          dbAdapter,
          user.id,
        );
        assert.strictEqual(subscriptions.length, 1);
        assert.strictEqual(subscriptions[0].status, 'active');
        assert.strictEqual(subscriptions[0].planId, creatorPlan.id);

        let waitForSubscriptionExpiryProcessed = new Deferred<void>();
        let waitForFreePlanSubscriptionProcessed = new Deferred<void>();

        // A function to simulate webhook call from stripe after we call 'stripe.subscription.create' endpoint
        let subscribeToFreePlan = async function () {
          await waitForSubscriptionExpiryProcessed.promise;
          let stripeInvoicePaymentSucceededEvent = {
            id: 'evt_1234567892',
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
          };
          let stripeInvoicePaymentSucceededPayload = JSON.stringify(
            stripeInvoicePaymentSucceededEvent,
          );
          let stripeInvoicePaymentSucceededSignature =
            Stripe.webhooks.generateTestHeaderString({
              payload: stripeInvoicePaymentSucceededPayload,
              secret,
              timestamp,
            });
          await request
            .post('/_stripe-webhook')
            .send(stripeInvoicePaymentSucceededPayload)
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('stripe-signature', stripeInvoicePaymentSucceededSignature);
          waitForFreePlanSubscriptionProcessed.fulfill();
        };
        const createSubscriptionResponse = {
          id: 'sub_1MowQVLkdIwHu7ixeRlqHVzs',
          object: 'subscription',
          automatic_tax: {
            enabled: false,
          },
          billing_cycle_anchor: 1679609767,
          cancel_at_period_end: false,
          collection_method: 'charge_automatically',
          created: 1679609767,
          currency: 'usd',
          current_period_end: 1682288167,
          current_period_start: 1679609767,
          customer: 'cus_123',
          invoice_settings: {
            issuer: {
              type: 'self',
            },
          },
        };
        createSubscriptionStub.callsFake(() => {
          subscribeToFreePlan();
          return createSubscriptionResponse;
        });

        let fetchPriceListResponse = {
          object: 'list',
          data: [
            {
              id: 'price_1QMRCxH9rBd1yAHRD4BXhAHW',
              object: 'price',
              active: true,
              billing_scheme: 'per_unit',
              created: 1731921923,
              currency: 'usd',
              custom_unit_amount: null,
              livemode: false,
              lookup_key: null,
              metadata: {},
              nickname: null,
              product: 'prod_REv3E69DbAPv4K',
              recurring: {
                aggregate_usage: null,
                interval: 'month',
                interval_count: 1,
                meter: null,
                trial_period_days: null,
                usage_type: 'licensed',
              },
              tax_behavior: 'unspecified',
              tiers_mode: null,
              transform_quantity: null,
              type: 'recurring',
              unit_amount: 0,
              unit_amount_decimal: '0',
            },
          ],
          has_more: false,
          url: '/v1/prices',
        };
        fetchPriceListStub.resolves(fetchPriceListResponse);

        let stripeSubscriptionDeletedEvent = {
          id: 'evt_sub_deleted_1',
          object: 'event',
          type: 'customer.subscription.deleted',
          data: {
            object: {
              id: 'sub_1234567890',
              canceled_at: 2,
              cancellation_details: {
                reason: 'payment_failure',
              },
              customer: 'cus_123',
            },
          },
        };
        let stripeSubscriptionDeletedPayload = JSON.stringify(
          stripeSubscriptionDeletedEvent,
        );
        let stripeSubscriptionDeletedSignature =
          Stripe.webhooks.generateTestHeaderString({
            payload: stripeSubscriptionDeletedPayload,
            secret,
            timestamp,
          });
        await request
          .post('/_stripe-webhook')
          .send(stripeSubscriptionDeletedPayload)
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('stripe-signature', stripeSubscriptionDeletedSignature);
        waitForSubscriptionExpiryProcessed.fulfill();

        await waitForFreePlanSubscriptionProcessed.promise;
        subscriptions = await fetchSubscriptionsByUserId(dbAdapter, user.id);
        assert.strictEqual(subscriptions.length, 2);
        assert.strictEqual(subscriptions[0].status, 'expired');
        assert.strictEqual(subscriptions[0].planId, creatorPlan.id);

        assert.strictEqual(subscriptions[1].status, 'active');
        assert.strictEqual(subscriptions[1].planId, freePlan.id);
        waitForBillingNotification(assert, assert.async());
      });

      test('ensures the current subscription expires when free plan subscription fails', async function (assert) {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        let user = await insertUser(
          dbAdapter,
          userId,
          'cus_123',
          'user@test.com',
        );
        await insertPlan(dbAdapter, 'Free plan', 0, 100, 'prod_free');
        let creatorPlan = await insertPlan(
          dbAdapter,
          'Creator',
          12,
          5000,
          'prod_creator',
        );

        if (!secret) {
          throw new Error('STRIPE_WEBHOOK_SECRET is not set');
        }
        let stripeInvoicePaymentSucceededEvent = {
          id: 'evt_1234567890',
          object: 'event',
          type: 'invoice.payment_succeeded',
          data: {
            object: {
              id: 'in_1234567890',
              object: 'invoice',
              amount_paid: 12,
              billing_reason: 'subscription_create',
              period_end: 1638465600,
              period_start: 1635873600,
              subscription: 'sub_1234567890',
              customer: 'cus_123',
              lines: {
                data: [
                  {
                    amount: 12,
                    price: { product: 'prod_creator' },
                  },
                ],
              },
            },
          },
        };

        let timestamp = Math.floor(Date.now() / 1000);
        let stripeInvoicePaymentSucceededPayload = JSON.stringify(
          stripeInvoicePaymentSucceededEvent,
        );
        let stripeInvoicePaymentSucceededSignature =
          Stripe.webhooks.generateTestHeaderString({
            payload: stripeInvoicePaymentSucceededPayload,
            secret,
            timestamp,
          });
        await request
          .post('/_stripe-webhook')
          .send(stripeInvoicePaymentSucceededPayload)
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('stripe-signature', stripeInvoicePaymentSucceededSignature);

        let subscriptions = await fetchSubscriptionsByUserId(
          dbAdapter,
          user.id,
        );
        assert.strictEqual(subscriptions.length, 1);
        assert.strictEqual(subscriptions[0].status, 'active');
        assert.strictEqual(subscriptions[0].planId, creatorPlan.id);

        createSubscriptionStub.throws({
          message: 'Failed subscribing to free plan',
        });
        let fetchPriceListResponse = {
          object: 'list',
          data: [
            {
              id: 'price_1QMRCxH9rBd1yAHRD4BXhAHW',
              object: 'price',
              active: true,
              billing_scheme: 'per_unit',
              created: 1731921923,
              currency: 'usd',
              custom_unit_amount: null,
              livemode: false,
              lookup_key: null,
              metadata: {},
              nickname: null,
              product: 'prod_REv3E69DbAPv4K',
              recurring: {
                aggregate_usage: null,
                interval: 'month',
                interval_count: 1,
                meter: null,
                trial_period_days: null,
                usage_type: 'licensed',
              },
              tax_behavior: 'unspecified',
              tiers_mode: null,
              transform_quantity: null,
              type: 'recurring',
              unit_amount: 0,
              unit_amount_decimal: '0',
            },
          ],
          has_more: false,
          url: '/v1/prices',
        };
        fetchPriceListStub.resolves(fetchPriceListResponse);

        let stripeSubscriptionDeletedEvent = {
          id: 'evt_sub_deleted_1',
          object: 'event',
          type: 'customer.subscription.deleted',
          data: {
            object: {
              id: 'sub_1234567890',
              canceled_at: 2,
              cancellation_details: {
                reason: 'payment_failure',
              },
              customer: 'cus_123',
            },
          },
        };
        let stripeSubscriptionDeletedPayload = JSON.stringify(
          stripeSubscriptionDeletedEvent,
        );
        let stripeSubscriptionDeletedSignature =
          Stripe.webhooks.generateTestHeaderString({
            payload: stripeSubscriptionDeletedPayload,
            secret,
            timestamp,
          });
        await request
          .post('/_stripe-webhook')
          .send(stripeSubscriptionDeletedPayload)
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('stripe-signature', stripeSubscriptionDeletedSignature);

        subscriptions = await fetchSubscriptionsByUserId(dbAdapter, user.id);
        assert.strictEqual(subscriptions.length, 1);
        assert.strictEqual(subscriptions[0].status, 'expired');
        assert.strictEqual(subscriptions[0].planId, creatorPlan.id);

        let response = await request
          .get(`/_user`)
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, '@test_realm:localhost', [
              'read',
              'write',
            ])}`,
          );
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              type: 'user',
              id: user.id,
              attributes: {
                matrixUserId: user.matrixUserId,
                stripeCustomerId: user.stripeCustomerId,
                stripeCustomerEmail: user.stripeCustomerEmail,
                creditsAvailableInPlanAllowance: null,
                creditsIncludedInPlanAllowance: null,
                extraCreditsAvailableInBalance: 0,
                lowCreditThreshold: null,
                lastDailyCreditGrantAt: null,
                nextDailyCreditGrantAt: null,
              },
              relationships: {
                subscription: null,
              },
            },
            included: [
              {
                type: 'plan',
                id: 'free',
                attributes: {
                  name: 'Free',
                  monthlyPrice: 0,
                  creditsIncluded: 0,
                },
              },
            ],
          },
          '/_user response is correct',
        );
      });

      test('sends billing notification on invoice payment succeeded event', async function (assert) {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        await insertUser(dbAdapter, userId!, 'cus_123', 'user@test.com');
        await insertPlan(dbAdapter, 'Free plan', 0, 100, 'prod_free');
        if (!secret) {
          throw new Error('STRIPE_WEBHOOK_SECRET is not set');
        }
        let event = {
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
        };

        let payload = JSON.stringify(event);
        let timestamp = Math.floor(Date.now() / 1000);
        let signature = Stripe.webhooks.generateTestHeaderString({
          payload,
          secret,
          timestamp,
        });

        await request
          .post('/_stripe-webhook')
          .send(payload)
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('stripe-signature', signature);
        waitForBillingNotification(assert, assert.async());
      });

      test('sends billing notification on checkout session completed event', async function (assert) {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        let user = await insertUser(
          dbAdapter,
          userId!,
          'cus_123',
          'user@test.com',
        );
        await insertPlan(dbAdapter, 'Free plan', 0, 100, 'prod_free');
        if (!secret) {
          throw new Error('STRIPE_WEBHOOK_SECRET is not set');
        }
        let event = {
          id: 'evt_1234567890',
          object: 'event',
          data: {
            object: {
              id: 'cs_test_1234567890',
              object: 'checkout.session',
              customer: 'cus_123',
              metadata: {
                user_id: user.id,
              },
            },
          },
          type: 'checkout.session.completed',
        };

        let payload = JSON.stringify(event);
        let timestamp = Math.floor(Date.now() / 1000);
        let signature = Stripe.webhooks.generateTestHeaderString({
          payload,
          secret,
          timestamp,
        });

        await request
          .post('/_stripe-webhook')
          .send(payload)
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('stripe-signature', signature);
        waitForBillingNotification(assert, assert.async());
      });
    });
  });
});

function messageEventContentIsRealmServerEvent(
  content: MatrixEvent['content'],
): content is RealmServerEventContent {
  return (
    'msgtype' in content &&
    (content.msgtype as string) === APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE
  );
}
