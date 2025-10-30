import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { stringify } from 'qs';
import type { Query } from '@cardstack/runtime-common/query';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  matrixURL,
  testRealmHref,
  createJWT,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | _search', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;

    setupBaseRealmServer(hooks, matrixURL);

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
          assert.strictEqual(json.meta.page.total, 1, 'total count is correct');
        });

        test('gets no results when asking for a type that the realm does not have knowledge of', async function (assert) {
          let unknownTypeQuery: Query = {
            filter: {
              on: {
                module: 'http://some-realm-server/some-realm/some-card',
                name: 'SomeCard',
              },
              eq: {
                firstName: 'Mango',
              },
            },
          };

          let response = await request
            .get(`/_search?${stringify(unknownTypeQuery)}`)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;

          assert.strictEqual(
            json.data.length,
            0,
            'returned results count is correct',
          );
          assert.strictEqual(json.meta.page.total, 0, 'total count is correct');
        });

        test('can paginate search results', async function (assert) {
          // Query for all persons to get multiple results
          let paginationQuery: Query = {
            filter: {
              type: {
                module: `${testRealmHref}person`,
                name: 'Person',
              },
            },
            page: {
              number: 0,
              size: 1,
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
            .get(`/_search?${stringify(paginationQuery)}`)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;

          assert.strictEqual(json.data.length, 1, 'first page has 1 result');
          assert.ok(json.meta, 'response includes meta');
          assert.ok(json.meta.page, 'meta includes page info');
          assert.strictEqual(json.meta.page.total, 3, 'total count is correct');

          // Get the second page
          paginationQuery.page = { number: 1, size: 1 };
          response = await request
            .get(`/_search?${stringify(paginationQuery)}`)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            'HTTP 200 status for second page',
          );
          let json2 = response.body;

          assert.strictEqual(json2.data.length, 1, 'second page has 1 result');
          assert.strictEqual(
            json2.meta.page.total,
            3,
            'total count is correct',
          );

          // Ensure different results on different pages
          assert.notStrictEqual(
            json.data[0].id,
            json2.data[0].id,
            'different pages should return different results',
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
          assert.strictEqual(json.meta.page.total, 1, 'total count is correct');
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
          assert.strictEqual(json.meta.page.total, 1, 'total count is correct');
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
