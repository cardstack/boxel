import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { join, resolve, basename } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';
import {
  baseRealm,
  Realm,
  RealmPermissions,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { stringify } from 'qs';
import { Query } from '@cardstack/runtime-common/query';
import {
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
  setupDB,
  createVirtualNetwork,
  createVirtualNetworkAndLoader,
  matrixURL,
  closeServer,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealmHref = testRealmURL.href;
const distDir = resolve(join(__dirname, '..', '..', 'host', 'dist'));
console.log(`using host dist dir: ${distDir}`);

let createJWT = (
  realm: Realm,
  user: string,
  permissions: RealmPermissions['user'] = [],
) => {
  return realm.createJWT(
    {
      user,
      realm: realm.url,
      permissions,
      sessionRoom: `test-session-room-for-${user}`,
    },
    '7d',
  );
};

module(basename(__filename), function () {
  module('Realm-specific Endpoints | _search', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;

    function setupPermissionedRealm(
      hooks: NestedHooks,
      permissions: RealmPermissions,
      fileSystem?: Record<string, string | LooseSingleCardDocument>,
    ) {
      setupDB(hooks, {
        beforeEach: async (_dbAdapter, publisher, runner) => {
          dir = dirSync();
          let testRealmDir = join(dir.name, '..', 'realm_server_1', 'test');
          ensureDirSync(testRealmDir);
          // If a fileSystem is provided, use it to populate the test realm, otherwise copy the default cards
          if (!fileSystem) {
            copySync(join(__dirname, '..', 'cards'), testRealmDir);
          }

          let virtualNetwork = createVirtualNetwork();

          ({ testRealm, testRealmHttpServer } = await runTestRealmServer({
            virtualNetwork,
            testRealmDir,
            realmsRootPath: join(dir.name, '..', 'realm_server_1'),
            realmURL: testRealmURL,
            permissions,
            dbAdapter: _dbAdapter,
            runner,
            publisher,
            matrixURL,
            fileSystem,
          }));

          request = supertest(testRealmHttpServer);
        },
      });
    }

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

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

    module('GET request', function (_hooks) {
      let query: Query = {
        filter: {
          on: {
            module: `${testRealmHref}person`,
            name: 'Person',
          },
          eq: {
            firstName: 'Mango',
          },
        },
      };

      module('public readable realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          '*': ['read'],
        });

        test('serves a /_search GET request', async function (assert) {
          let response = await request
            .get(`/_search?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmURL.href,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let json = response.body;
          assert.strictEqual(
            json.data.length,
            1,
            'the card is returned in the search results',
          );
          assert.strictEqual(
            json.data[0].id,
            `${testRealmHref}person-1`,
            'card ID is correct',
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          john: ['read'],
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .get(`/_search?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .get(`/_search?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json'); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .get(`/_search?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .get(`/_search?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
        });
      });
    });

    module('QUERY request', function (_hooks) {
      let query = {
        filter: {
          on: {
            module: `${testRealmHref}person`,
            name: 'Person',
          },
          eq: {
            firstName: 'Mango',
          },
        },
      };

      module('public readable realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          '*': ['read'],
        });

        test('serves a /_search QUERY request', async function (assert) {
          let response = await request
            .post('/_search')
            .send(query)
            .set('Accept', 'application/vnd.card+json')
            .set('Content-Type', 'application/json')
            .set('X-HTTP-Method-Override', 'QUERY'); // Use method override since supertest doesn't support QUERY directly

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmURL.href,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let json = response.body;
          assert.strictEqual(
            json.data.length,
            1,
            'the card is returned in the search results',
          );
          assert.strictEqual(
            json.data[0].id,
            `${testRealmHref}person-1`,
            'card ID is correct',
          );
        });

        test('handles complex queries in request body', async function (assert) {
          let complexQuery = {
            filter: {
              on: {
                module: `${testRealmHref}person`,
                name: 'Person',
              },
              any: [
                { eq: { firstName: 'Mango' } },
                { eq: { firstName: 'Tango' } },
              ],
            },
            sort: [
              {
                by: 'firstName',
                on: { module: `${testRealmHref}person`, name: 'Person' },
                direction: 'asc',
              },
            ],
          };

          let response = await request
            .post('/_search')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(complexQuery);

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;
          assert.ok(json.data, 'response has data');
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          john: ['read'],
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .post('/_search')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer invalid-token`)
            .send(query);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .post('/_search')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .post('/_search')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`)
            .send(query);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .post('/_search')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            )
            .send(query);

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
        });
      });

      module('search query validation', function (hooks) {
        setupPermissionedRealm(hooks, {
          '*': ['read'],
        });

        test('400 with invalid query schema', async function (assert) {
          let response = await request
            .post('/_search')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({ invalid: 'query structure' });

          assert.strictEqual(response.status, 400, 'HTTP 400 status');
          assert.ok(
            response.body.errors[0].message.includes('Invalid query'),
            'Error message indicates invalid query',
          );
        });

        test('400 with invalid filter logic', async function (assert) {
          let response = await request
            .post('/_search')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              filter: {
                badOperator: { firstName: 'Mango' },
              },
            });

          assert.strictEqual(response.status, 400, 'HTTP 400 status');
        });
      });
    });
  });
});
