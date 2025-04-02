import { module, test } from 'qunit';
import { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import { baseRealm, Realm, RealmPermissions } from '@cardstack/runtime-common';
import { stringify } from 'qs';
import { Query } from '@cardstack/runtime-common/query';
import {
  setupCardLogs,
  setupBaseRealmServer,
  setupPermissionedRealm,
  createVirtualNetworkAndLoader,
  matrixURL,
  testRealmHref,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

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

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | _search', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
    }) {
      testRealm = args.testRealm;
      request = args.request;
    }

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
          permissions: {
            '*': ['read'],
          },
          onRealmSetup,
        });

        test('serves a /_search GET request', async function (assert) {
          let response = await request
            .get(`/_search?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
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
          permissions: {
            john: ['read'],
          },
          onRealmSetup,
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
          permissions: {
            '*': ['read'],
          },
          onRealmSetup,
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
            testRealmHref,
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
          permissions: {
            john: ['read'],
          },
          onRealmSetup,
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
          permissions: {
            '*': ['read'],
          },
          onRealmSetup,
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
