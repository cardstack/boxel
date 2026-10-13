import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  archiveRealm,
  Deferred,
  insertPermissions,
  param,
  query,
} from '@cardstack/runtime-common';
import {
  grafanaSecret,
  realmSecretSeed,
  testRealmInfo,
} from '../helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import { insertSourceRealmInRegistry } from '../../lib/realm-registry-writes.ts';
import { setupServerEndpointsTest, testRealmURL } from './helpers.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module(
    'Realm Server Endpoints (not specific to one realm)',
    function (hooks) {
      // `_catalog-realms` asserts the realm's `name === "Test Realm"`,
      // which comes from the realm.json RealmConfig instance
      // — only present in `realistic`.
      let context = setupServerEndpointsTest(hooks, { fixture: 'realistic' });
      let originalLowCreditThreshold: string | undefined;

      hooks.beforeEach(function () {
        originalLowCreditThreshold = process.env.LOW_CREDIT_THRESHOLD;
        process.env.LOW_CREDIT_THRESHOLD = '2000';
      });

      hooks.afterEach(function () {
        if (originalLowCreditThreshold == null) {
          delete process.env.LOW_CREDIT_THRESHOLD;
        } else {
          process.env.LOW_CREDIT_THRESHOLD = originalLowCreditThreshold;
        }
      });

      test('can create a user', async function (assert) {
        let ownerUserId = '@mango-new:localhost';
        let response = await context.request
          .post('/_user')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send({
            data: {
              type: 'user',
              attributes: {
                registrationToken: 'reg_token_123',
              },
            },
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(response.text, 'ok', 'response body is correct');

        let user = await getUserByMatrixUserId(context.dbAdapter, ownerUserId);
        if (!user) {
          throw new Error('user does not exist in db');
        }
        assert.strictEqual(
          user.matrixUserId,
          ownerUserId,
          'matrix user ID is correct',
        );
        assert.strictEqual(
          user.matrixRegistrationToken,
          'reg_token_123',
          'registration token is correct',
        );
      });

      test('can not create a user without a jwt', async function (assert) {
        let response = await context.request.post('/_user').send({});
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('omits realms not opted into the catalog', async function (assert) {
        let response = await context.request
          .get('/_catalog-realms')
          .set('Accept', 'application/json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(response.body, { data: [] });
      });

      test('includes realms with showAsCatalog: true', async function (assert) {
        await query(context.dbAdapter, [
          `INSERT INTO realm_metadata (url, show_as_catalog) VALUES (`,
          param(testRealmURL.href),
          `, `,
          param(true),
          `) ON CONFLICT (url) DO UPDATE SET show_as_catalog = `,
          param(true),
        ]);
        context.testRealm.invalidateCachedRealmInfo();
        resetCatalogRealms();

        let response = await context.request
          .get('/_catalog-realms')
          .set('Accept', 'application/json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        // `/_catalog-realms` forwards each realm's `/_info` attributes
        // verbatim, and that route serves the plain RealmInfo.
        assert.deepEqual(response.body.data, [
          {
            type: 'catalog-realm',
            id: `${testRealmURL}`,
            attributes: {
              ...testRealmInfo,
              showAsCatalog: true,
            },
          },
        ]);
      });

      test(`returns 200 with empty data if failed to fetch catalog realm's info`, async function (assert) {
        await query(context.dbAdapter, [
          `INSERT INTO realm_metadata (url, show_as_catalog) VALUES (`,
          param(testRealmURL.href),
          `, `,
          param(true),
          `) ON CONFLICT (url) DO UPDATE SET show_as_catalog = `,
          param(true),
        ]);
        resetCatalogRealms();
        let failedRealmInfoMock = async (req: Request) => {
          if (req.url.includes('_info')) {
            return new Response('Failed to fetch realm info', {
              status: 500,
              statusText: 'Internal Server Error',
            });
          }
          return null;
        };
        context.virtualNetwork.mount(failedRealmInfoMock, { prepend: true });
        let response = await context.request
          .get('/_catalog-realms')
          .set('Accept', 'application/json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(response.body, {
          data: [],
        });
      });

      test('GET /_public-realms lists the active public source realms with their names', async function (assert) {
        await insertSourceRealmInRegistry(context.dbAdapter, {
          url: testRealmURL.href,
          diskId: 'node-test_realm/test',
          ownerUsername: 'node-test_realm',
        });
        const privateRealmURL = 'http://127.0.0.1:4444/someone/private/';
        const archivedRealmURL = 'http://127.0.0.1:4444/someone/archived/';
        for (let url of [privateRealmURL, archivedRealmURL]) {
          await insertSourceRealmInRegistry(context.dbAdapter, {
            url,
            diskId: new URL(url).pathname.slice(1, -1),
            ownerUsername: 'someone',
          });
        }
        await insertPermissions(context.dbAdapter, new URL(privateRealmURL), {
          '@someone:localhost': ['read', 'write', 'realm-owner'],
        });
        await insertPermissions(context.dbAdapter, new URL(archivedRealmURL), {
          '*': ['read'],
          '@someone:localhost': ['read', 'write', 'realm-owner'],
        });
        await archiveRealm(context.dbAdapter, new URL(archivedRealmURL));

        let response = await context.request
          .get('/_public-realms')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: '@mango:localhost', sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let realms = response.body.data as {
          id: string;
          attributes: { name: string | null };
        }[];
        let testRealm = realms.find(({ id }) => id === testRealmURL.href);
        assert.strictEqual(
          testRealm?.attributes.name,
          'Test Realm',
          'the public realm is listed with the name from its realm.json',
        );
        let ids = realms.map(({ id }) => id);
        assert.false(
          ids.includes(privateRealmURL),
          'a realm that is not public is not listed',
        );
        assert.false(
          ids.includes(archivedRealmURL),
          'an archived public realm is not listed',
        );
      });

      test('GET /_public-realms requires a signed-in user', async function (assert) {
        let response = await context.request
          .get('/_public-realms')
          .set('Accept', 'application/vnd.api+json');
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      function setRealmCatalog(params: string, secret = grafanaSecret) {
        return context.request
          .post(`/_grafana-set-realm-catalog?${params}`)
          .set('Authorization', `Bearer ${secret}`);
      }

      async function catalogRealms() {
        let response = await context.request
          .get('/_catalog-realms')
          .set('Accept', 'application/json');
        return response.body.data as {
          id: string;
          attributes: { showAsCatalog: boolean | null };
        }[];
      }

      async function catalogRealmIds() {
        return (await catalogRealms()).map(({ id }) => id);
      }

      test('the grafana set-realm-catalog endpoint adds a public realm to the catalog and takes it out again', async function (assert) {
        let realm = encodeURIComponent(testRealmURL.href);

        let added = await setRealmCatalog(`realm=${realm}&catalog=true`);
        assert.strictEqual(added.status, 200, 'HTTP 200 adding the realm');
        assert.deepEqual(
          { realm: added.body.realm, showAsCatalog: added.body.showAsCatalog },
          { realm: testRealmURL.href, showAsCatalog: true },
        );
        let listed = await catalogRealms();
        assert.deepEqual(
          listed.map(({ id }) => id),
          [testRealmURL.href],
          'the realm is listed as a catalog right away',
        );
        assert.true(
          listed[0].attributes.showAsCatalog,
          'the realm info served with it reports showAsCatalog',
        );

        let removed = await setRealmCatalog(`realm=${realm}&catalog=false`);
        assert.strictEqual(removed.status, 200, 'HTTP 200 removing the realm');
        assert.deepEqual(
          await catalogRealmIds(),
          [],
          'the realm is no longer listed as a catalog',
        );
      });

      test('a catalog change made while the list is being refreshed is not overwritten by that refresh', async function (assert) {
        await query(context.dbAdapter, [
          `INSERT INTO realm_metadata (url, show_as_catalog) VALUES (`,
          param(testRealmURL.href),
          `, `,
          param(true),
          `) ON CONFLICT (url) DO UPDATE SET show_as_catalog = `,
          param(true),
        ]);
        resetCatalogRealms();

        // Hold the refresh at its `_info` call until the catalog has changed.
        let infoRequested = new Deferred<void>();
        let releaseInfo = new Deferred<void>();
        let holding = true;
        context.virtualNetwork.mount(
          async (req: Request) => {
            if (holding && req.url.endsWith('/_info')) {
              holding = false;
              infoRequested.fulfill();
              await releaseInfo.promise;
            }
            return null;
          },
          { prepend: true },
        );
        let staleRefresh = context.request
          .get('/_catalog-realms')
          .set('Accept', 'application/json')
          .then((response) => response);
        await infoRequested.promise;

        let removed = await setRealmCatalog(
          `realm=${encodeURIComponent(testRealmURL.href)}&catalog=false`,
        );
        assert.strictEqual(removed.status, 200, 'HTTP 200 removing the realm');
        releaseInfo.fulfill();
        await staleRefresh;

        assert.deepEqual(
          await catalogRealmIds(),
          [],
          'the list read after the change leaves the realm out',
        );
      });

      test('the grafana set-realm-catalog endpoint refuses a realm that is not publicly readable', async function (assert) {
        await query(context.dbAdapter, [
          `DELETE FROM realm_user_permissions WHERE username = '*' AND realm_url =`,
          param(testRealmURL.href),
        ]);

        let response = await setRealmCatalog(
          `realm=${encodeURIComponent(testRealmURL.href)}&catalog=true`,
        );
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        assert.deepEqual(await catalogRealmIds(), [], 'nothing is listed');
      });

      test('the grafana set-realm-catalog endpoint validates its params and its secret', async function (assert) {
        let realm = encodeURIComponent(testRealmURL.href);
        assert.strictEqual(
          (await setRealmCatalog(`catalog=true`)).status,
          400,
          'a missing realm is refused',
        );
        assert.strictEqual(
          (await setRealmCatalog(`realm=${realm}&catalog=yes`)).status,
          400,
          'a catalog value other than true/false is refused',
        );
        assert.strictEqual(
          (
            await setRealmCatalog(
              `realm=${encodeURIComponent('http://127.0.0.1:4444/no-such-realm/')}&catalog=true`,
            )
          ).status,
          400,
          'a URL that is not a realm on this server is refused',
        );
        assert.strictEqual(
          (await setRealmCatalog(`realm=${realm}&catalog=true`, 'wrong'))
            .status,
          401,
          'a wrong grafana secret is refused',
        );
        assert.deepEqual(await catalogRealmIds(), [], 'nothing is listed');
      });
    },
  );
});
