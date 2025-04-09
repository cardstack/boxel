import { module, test } from 'qunit';
import { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import { Server } from 'http';
import { dirSync, type DirResult } from 'tmp';
import { copySync } from 'fs-extra';
import { baseRealm, Realm } from '@cardstack/runtime-common';
import {
  setupCardLogs,
  setupBaseRealmServer,
  setupPermissionedRealm,
  createVirtualNetworkAndLoader,
  matrixURL,
  closeServer,
  insertUser,
  insertPlan,
  createJWT,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { type PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  insertSubscriptionCycle,
  insertSubscription,
} from '@cardstack/billing/billing-queries';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | GET _user', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dbAdapter: PgAdapter;
      dir: DirResult;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      request = args.request;
      dbAdapter = args.dbAdapter;
      dir = args.dir;
    }

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    hooks.beforeEach(async function () {
      dir = dirSync();
      copySync(join(__dirname, '..', 'cards'), dir.name);
    });

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    setupPermissionedRealm(hooks, {
      permissions: {
        john: ['read', 'write'],
      },
      onRealmSetup,
    });

    test('responds with 404 if user is not found', async function (assert) {
      let response = await request
        .get(`/_user`)
        .set('Accept', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );
      assert.strictEqual(response.status, 404, 'HTTP 404 status');
    });

    test('responds with 200 and null subscription values if user is not subscribed', async function (assert) {
      let user = await insertUser(
        dbAdapter,
        'user@test',
        'cus_123',
        'user@test.com',
      );
      let response = await request
        .get(`/_user`)
        .set('Accept', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user@test', ['read', 'write'])}`,
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
              extraCreditsAvailableInBalance: null,
            },
            relationships: {
              subscription: null,
            },
          },
          included: null,
        },
        '/_user response is correct',
      );
    });

    test('response has correct values for subscribed user who has some extra credits', async function (assert) {
      let user = await insertUser(
        dbAdapter,
        'user@test',
        'cus_123',
        'user@test.com',
      );
      let someOtherUser = await insertUser(
        dbAdapter,
        'some-other-user@test',
        'cus_1234',
        'other@test.com',
      ); // For the purposes of testing that we don't return the wrong user's subscription's data

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
        creditAmount: 100,
        creditType: 'extra_credit',
        subscriptionCycleId: subscriptionCycle.id,
      });

      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: 2500,
        creditType: 'plan_allowance',
        subscriptionCycleId: subscriptionCycle.id,
      });

      // Set up other user's subscription
      let otherUserSubscription = await insertSubscription(dbAdapter, {
        user_id: someOtherUser.id,
        plan_id: plan.id,
        started_at: 1,
        status: 'active',
        stripe_subscription_id: 'sub_1234567891',
      });

      let otherUserSubscriptionCycle = await insertSubscriptionCycle(
        dbAdapter,
        {
          subscriptionId: otherUserSubscription.id,
          periodStart: 1,
          periodEnd: 2,
        },
      );

      await addToCreditsLedger(dbAdapter, {
        userId: someOtherUser.id,
        creditAmount: 100,
        creditType: 'extra_credit',
        subscriptionCycleId: otherUserSubscriptionCycle.id,
      }); // this is to test that this extra credit amount does not influence the original user's credit calculation

      let response = await request
        .get(`/_user`)
        .set('Accept', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user@test', ['read', 'write'])}`,
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
              creditsAvailableInPlanAllowance: 2500,
              creditsIncludedInPlanAllowance: 2500,
              extraCreditsAvailableInBalance: 100,
            },
            relationships: {
              subscription: {
                data: {
                  type: 'subscription',
                  id: subscription.id,
                },
              },
            },
          },
          included: [
            {
              type: 'subscription',
              id: subscription.id,
              attributes: {
                startedAt: 1,
                endedAt: null,
                status: 'active',
              },
              relationships: {
                plan: {
                  data: {
                    type: 'plan',
                    id: plan.id,
                  },
                },
              },
            },
            {
              type: 'plan',
              id: plan.id,
              attributes: {
                name: plan.name,
                monthlyPrice: plan.monthlyPrice,
                creditsIncluded: plan.creditsIncluded,
              },
            },
          ],
        },
        '/_user response is correct',
      );
    });
  });
});
