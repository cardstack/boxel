import { module, test } from 'qunit';
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import sinon from 'sinon';
import { getStripe } from '@cardstack/billing/stripe-webhook-handlers/stripe';
import type { PgAdapter } from '@cardstack/postgres';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  insertPlan,
  insertUser,
  realmSecretSeed,
  realmServerTestMatrix,
  setupPermissionedRealm,
} from '../helpers';
import { createRealmServerSession } from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('Realm Server Endpoints (not specific to one realm)', function () {
    module('stripe session handler', function (hooks) {
      let createCustomerStub: sinon.SinonStub;
      let createCheckoutSessionStub: sinon.SinonStub;
      let listSubscriptionsStub: sinon.SinonStub;
      let retrieveProductStub: sinon.SinonStub;
      let createBillingPortalSessionStub: sinon.SinonStub;
      let matrixClient: MatrixClient;
      let userId = '@test_realm:localhost';
      let jwtToken: string;
      let request: SuperTest<Test>;
      let dbAdapter: PgAdapter;

      function onRealmSetup(args: {
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
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
        createCustomerStub = sinon.stub(stripe.customers, 'create');
        createCheckoutSessionStub = sinon.stub(
          stripe.checkout.sessions,
          'create',
        );
        listSubscriptionsStub = sinon.stub(stripe.subscriptions, 'list');
        retrieveProductStub = sinon.stub(stripe.products, 'retrieve');
        createBillingPortalSessionStub = sinon.stub(
          stripe.billingPortal.sessions,
          'create',
        );

        matrixClient = new MatrixClient({
          matrixURL: realmServerTestMatrix.url,
          username: 'test_realm',
          seed: realmSecretSeed,
        });
        await matrixClient.login();
        let { sessionRoom, jwt } = await createRealmServerSession(
          matrixClient,
          request,
        );

        let { joined_rooms: rooms } = await matrixClient.getJoinedRooms();

        if (!rooms.includes(sessionRoom)) {
          await matrixClient.joinRoom(sessionRoom);
        }

        jwtToken = jwt;
      });

      hooks.afterEach(async function () {
        createCustomerStub.restore();
        createCheckoutSessionStub.restore();
        listSubscriptionsStub.restore();
        retrieveProductStub.restore();
        createBillingPortalSessionStub.restore();
      });

      test('creates checkout session for AI tokens when user has no Stripe customer', async function (assert) {
        let user = await insertUser(
          dbAdapter,
          userId,
          '', // no stripe customer id
          '',
        );

        const mockCustomer = {
          id: 'cus_test123',
          email: 'test@example.com',
        };

        const mockSession = {
          id: 'cs_test123',
          url: 'https://checkout.stripe.com/test123',
        };

        createCustomerStub.resolves(mockCustomer);
        createCheckoutSessionStub.resolves(mockSession);

        let response = await request
          .post(
            '/_stripe-session?returnUrl=http%3A//example.com/return&email=test@example.com&aiTokenAmount=2500',
          )
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', jwtToken);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            url: 'https://checkout.stripe.com/test123',
            sessionId: 'cs_test123',
            type: 'checkout',
          },
          'response body is correct',
        );

        // Verify Stripe customer was created
        assert.ok(createCustomerStub.calledOnce, 'customer.create was called');
        assert.deepEqual(
          createCustomerStub.firstCall.args[0],
          { email: 'test@example.com' },
          'customer created with correct email',
        );

        // Verify checkout session was created
        assert.ok(
          createCheckoutSessionStub.calledOnce,
          'checkout.sessions.create was called',
        );
        let sessionArgs = createCheckoutSessionStub.firstCall.args[0];
        assert.strictEqual(
          sessionArgs.customer,
          'cus_test123',
          'session created with correct customer',
        );
        assert.strictEqual(
          sessionArgs.mode,
          'payment',
          'session mode is payment',
        );
        assert.strictEqual(
          sessionArgs.success_url,
          'http://example.com/return',
          'success URL is correct',
        );
        assert.strictEqual(
          sessionArgs.cancel_url,
          'http://example.com/return',
          'cancel URL is correct',
        );
        assert.strictEqual(
          sessionArgs.line_items[0].price_data.unit_amount,
          500,
          'price is correct (5 USD)',
        );
        assert.strictEqual(
          sessionArgs.line_items[0].price_data.product_data.name,
          '2,500 AI credits',
          'product name is correct',
        );
        assert.strictEqual(
          sessionArgs.metadata.credit_reload_amount,
          '2500',
          'metadata has correct credit amount',
        );
        assert.strictEqual(
          sessionArgs.metadata.user_id,
          user.id,
          'metadata has correct user id',
        );

        // Verify user was updated with Stripe customer info
        let updatedUser = await getUserByMatrixUserId(dbAdapter, userId);
        assert.strictEqual(
          updatedUser?.stripeCustomerId,
          'cus_test123',
          'user updated with customer ID',
        );
        assert.strictEqual(
          updatedUser?.stripeCustomerEmail,
          'test@example.com',
          'user updated with customer email',
        );
      });

      test('creates checkout session for AI tokens when user already has Stripe customer', async function (assert) {
        let user = await insertUser(
          dbAdapter,
          userId,
          'cus_existing123', // existing stripe customer id
          'existing@example.com',
        );

        const mockSession = {
          id: 'cs_test456',
          url: 'https://checkout.stripe.com/test456',
        };

        createCheckoutSessionStub.resolves(mockSession);

        let response = await request
          .post(
            '/_stripe-session?returnUrl=http%3A//example.com/return&email=test@example.com&aiTokenAmount=20000',
          )
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', jwtToken);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            url: 'https://checkout.stripe.com/test456',
            sessionId: 'cs_test456',
            type: 'checkout',
          },
          'response body is correct',
        );

        // Verify Stripe customer was NOT created (since user already has one)
        assert.ok(
          createCustomerStub.notCalled,
          'customer.create was not called',
        );

        // Verify checkout session was created with existing customer
        assert.ok(
          createCheckoutSessionStub.calledOnce,
          'checkout.sessions.create was called',
        );
        let sessionArgs = createCheckoutSessionStub.firstCall.args[0];
        assert.strictEqual(
          sessionArgs.customer,
          'cus_existing123',
          'session created with existing customer ID',
        );
        assert.strictEqual(
          sessionArgs.mode,
          'payment',
          'session mode is payment',
        );
        assert.strictEqual(
          sessionArgs.success_url,
          'http://example.com/return',
          'success URL is correct',
        );
        assert.strictEqual(
          sessionArgs.cancel_url,
          'http://example.com/return',
          'cancel URL is correct',
        );
        assert.strictEqual(
          sessionArgs.line_items[0].price_data.unit_amount,
          3000,
          'price is correct (30 USD for 20000 tokens)',
        );
        assert.strictEqual(
          sessionArgs.line_items[0].price_data.product_data.name,
          '20,000 AI credits',
          'product name is correct',
        );
        assert.strictEqual(
          sessionArgs.metadata.credit_reload_amount,
          '20000',
          'metadata has correct credit amount',
        );
        assert.strictEqual(
          sessionArgs.metadata.user_id,
          user.id,
          'metadata has correct user id',
        );

        // Verify user info remains unchanged
        let updatedUser = await getUserByMatrixUserId(dbAdapter, userId);
        assert.strictEqual(
          updatedUser?.stripeCustomerId,
          'cus_existing123',
          'user customer ID unchanged',
        );
        assert.strictEqual(
          updatedUser?.stripeCustomerEmail,
          'existing@example.com',
          'user customer email unchanged',
        );
      });

      test('creates checkout session for subscription when user has no active subscription', async function (assert) {
        let user = await insertUser(
          dbAdapter,
          userId,
          'cus_existing123', // existing stripe customer id
          'existing@example.com',
        );

        // Create a test plan
        let plan = await insertPlan(
          dbAdapter,
          'TestPlan',
          12,
          5000,
          'prod_test_plan',
        );

        const mockSession = {
          id: 'cs_subscription_test',
          url: 'https://checkout.stripe.com/subscription',
        };

        const mockProduct = {
          id: 'prod_test_plan',
          default_price: 'price_123',
        };

        // User has no active subscriptions
        listSubscriptionsStub.resolves({ data: [] });
        retrieveProductStub.resolves(mockProduct);
        createCheckoutSessionStub.resolves(mockSession);

        let response = await request
          .post(
            '/_stripe-session?returnUrl=http%3A//example.com/return&plan=TestPlan',
          )
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', jwtToken);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            url: 'https://checkout.stripe.com/subscription',
            sessionId: 'cs_subscription_test',
            type: 'checkout',
          },
          'response body is correct',
        );

        // Verify subscriptions.list was called to check for active subscriptions
        assert.ok(
          listSubscriptionsStub.calledOnce,
          'subscriptions.list was called',
        );
        assert.deepEqual(
          listSubscriptionsStub.firstCall.args[0],
          {
            customer: 'cus_existing123',
            status: 'active',
            limit: 1,
          },
          'subscriptions listed with correct parameters',
        );

        // Verify product was retrieved
        assert.ok(
          retrieveProductStub.calledOnce,
          'products.retrieve was called',
        );
        assert.strictEqual(
          retrieveProductStub.firstCall.args[0],
          'prod_test_plan',
          'correct product ID was used',
        );

        // Verify checkout session was created for subscription
        assert.ok(
          createCheckoutSessionStub.calledOnce,
          'checkout.sessions.create was called',
        );
        let sessionArgs = createCheckoutSessionStub.firstCall.args[0];
        assert.strictEqual(
          sessionArgs.customer,
          'cus_existing123',
          'session created with correct customer',
        );
        assert.strictEqual(
          sessionArgs.mode,
          'subscription',
          'session mode is subscription',
        );
        assert.strictEqual(
          sessionArgs.success_url,
          'http://example.com/return',
          'success URL is correct',
        );
        assert.strictEqual(
          sessionArgs.cancel_url,
          'http://example.com/return',
          'cancel URL is correct',
        );
        assert.deepEqual(
          sessionArgs.line_items,
          [
            {
              price: 'price_123',
              quantity: 1,
            },
          ],
          'line items are correct',
        );
        assert.deepEqual(
          sessionArgs.payment_method_data,
          {
            allow_redisplay: 'always',
          },
          'payment method data allows redisplay',
        );
        assert.deepEqual(
          sessionArgs.metadata,
          {
            plan_name: 'TestPlan',
            plan_id: plan.id,
            user_id: user.id,
          },
          'metadata is correct',
        );

        // Verify Stripe customer was NOT created (since user already has one)
        assert.ok(
          createCustomerStub.notCalled,
          'customer.create was not called',
        );
      });

      test('creates billing portal session when user already has active subscription', async function (assert) {
        // Create a test plan
        await insertPlan(
          dbAdapter,
          'ExistingPlan',
          15,
          7500,
          'prod_existing_plan',
        );

        await insertUser(
          dbAdapter,
          userId,
          'cus_existing456',
          'existing@example.com',
        );

        const mockPortalSession = {
          url: 'https://billing.stripe.com/portal123',
        };

        // User has an active subscription
        listSubscriptionsStub.resolves({
          data: [
            {
              id: 'sub_active123',
              status: 'active',
              customer: 'cus_existing456',
            },
          ],
        });
        createBillingPortalSessionStub.resolves(mockPortalSession);

        let response = await request
          .post(
            '/_stripe-session?returnUrl=http%3A//example.com/return&plan=ExistingPlan',
          )
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', jwtToken);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            url: 'https://billing.stripe.com/portal123',
            type: 'portal',
            message:
              'You already have an active subscription. Redirecting to manage your subscription...',
          },
          'response body is correct',
        );

        // Verify subscriptions.list was called to check for active subscriptions
        assert.ok(
          listSubscriptionsStub.calledOnce,
          'subscriptions.list was called',
        );
        assert.deepEqual(
          listSubscriptionsStub.firstCall.args[0],
          {
            customer: 'cus_existing456',
            status: 'active',
            limit: 1,
          },
          'subscriptions listed with correct parameters',
        );

        // Verify billing portal session was created
        assert.ok(
          createBillingPortalSessionStub.calledOnce,
          'billingPortal.sessions.create was called',
        );
        assert.deepEqual(
          createBillingPortalSessionStub.firstCall.args[0],
          {
            customer: 'cus_existing456',
            return_url: 'http://example.com/return',
          },
          'billing portal session created with correct parameters',
        );

        // Verify product retrieval and checkout session creation were NOT called
        assert.ok(
          retrieveProductStub.notCalled,
          'products.retrieve was not called',
        );
        assert.ok(
          createCheckoutSessionStub.notCalled,
          'checkout.sessions.create was not called',
        );

        // Verify Stripe customer was NOT created
        assert.ok(
          createCustomerStub.notCalled,
          'customer.create was not called',
        );
      });
    });
  });
});
