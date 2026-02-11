import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import { baseRealm, type Realm } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import { setupPermissionedRealm, createJWT } from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | _search', function () {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let realmURL: URL;
    let realmHref: string;
    let searchPath: string;

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
    }) {
      testRealm = args.testRealm;
      request = args.request;
      realmURL = new URL(testRealm.url);
      realmHref = realmURL.href;
      searchPath = `${realmURL.pathname.replace(/\/$/, '')}/_search`;
    }

    function buildPersonQuery(firstName = 'Mango'): Query {
      return {
        filter: {
          on: {
            module: `${realmHref}person`,
            name: 'Person',
          },
          eq: {
            firstName,
          },
        },
      };
    }

    function buildFileDefQuery(): Query {
      return {
        filter: {
          type: {
            module: `${baseRealm.url}file-api`,
            name: 'FileDef',
          },
        },
      };
    }

    module('QUERY request (public realm)', function (_hooks) {
      let query = () => buildPersonQuery('Mango');

      module('public readable realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read'],
          },
          realmURL: new URL('http://127.0.0.1:4444/test/'),
          onRealmSetup,
        });

        test('serves a /_search QUERY request', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query());

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            realmHref,
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
            `${realmHref}person-1`,
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
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(unknownTypeQuery);

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
                module: `${realmHref}person`,
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
                on: { module: `${realmHref}person`, name: 'Person' },
                direction: 'asc',
              },
            ],
          };

          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(paginationQuery);

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;

          assert.strictEqual(json.data.length, 1, 'first page has 1 result');
          assert.ok(json.meta, 'response includes meta');
          assert.ok(json.meta.page, 'meta includes page info');
          assert.strictEqual(json.meta.page.total, 3, 'total count is correct');

          // Get the second page
          paginationQuery.page = { number: 1, size: 1 };
          response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(paginationQuery);

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

        test('serves file-meta results when querying for FileDef', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(buildFileDefQuery());

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body as { data: { id?: string; type: string }[] };

          assert.ok(json.data.length > 0, 'file-meta results are returned');
          assert.ok(
            json.data.every((entry) => entry.type === 'file-meta'),
            'all results are file-meta resources',
          );
          assert.ok(
            json.data.some((entry) => entry.id === `${realmHref}dir/foo.txt`),
            'expected file-meta entry is present',
          );
        });

        test('filters file-meta results by url', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              filter: {
                on: {
                  module: `${baseRealm.url}file-api`,
                  name: 'FileDef',
                },
                eq: {
                  url: `${realmHref}dir/foo.txt`,
                },
              },
            });

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body as { data: { id?: string; type: string }[] };

          assert.deepEqual(
            json.data.map((entry) => entry.id),
            [`${realmHref}dir/foo.txt`],
            'url filter returns matching file-meta entry',
          );
          assert.strictEqual(
            json.data[0]?.type,
            'file-meta',
            'url filter returns file-meta resource',
          );
        });

        test('filters file-meta results by FileDef subclass type', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              filter: {
                type: {
                  module: `${baseRealm.url}markdown-file-def`,
                  name: 'MarkdownDef',
                },
              },
            });

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body as { data: { id?: string; type: string }[] };

          assert.ok(
            json.data.some((entry) => entry.id === `${realmHref}sample.md`),
            'returns file-meta entries for subclass FileDef type',
          );
        });

        test('sparse fieldsets: empty fields returns resources with no attributes', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              ...buildFileDefQuery(),
              fields: { 'file-meta': [] },
              asData: true,
            });

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body as {
            data: {
              id?: string;
              type: string;
              attributes?: Record<string, any>;
              meta?: Record<string, any>;
              links?: Record<string, any>;
            }[];
          };

          assert.ok(json.data.length > 0, 'results are returned');
          for (let entry of json.data) {
            assert.strictEqual(
              entry.type,
              'file-meta',
              'resource type is preserved',
            );
            assert.ok(entry.id, 'resource id is preserved');
            assert.ok(entry.meta, 'resource meta is preserved');
            assert.deepEqual(
              entry.attributes,
              {},
              'attributes are empty when fields is empty array',
            );
          }
        });

        test('sparse fieldsets: specific fields returns only those attributes', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              ...buildFileDefQuery(),
              fields: { 'file-meta': ['name', 'url'] },
              asData: true,
            });

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body as {
            data: {
              id?: string;
              type: string;
              attributes?: Record<string, any>;
            }[];
          };

          assert.ok(json.data.length > 0, 'results are returned');
          for (let entry of json.data) {
            let attrKeys = Object.keys(entry.attributes ?? {});
            assert.ok(
              attrKeys.every((k) => ['name', 'url'].includes(k)),
              `attributes only contain requested fields, got: ${attrKeys.join(', ')}`,
            );
            assert.notStrictEqual(
              entry.attributes?.name,
              undefined,
              'name attribute is present',
            );
            assert.notStrictEqual(
              entry.attributes?.url,
              undefined,
              'url attribute is present',
            );
          }
        });

        test('sparse fieldsets: invalid fields value returns 400', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              ...buildFileDefQuery(),
              fields: { 'file-meta': 'not-an-array' },
              asData: true,
            });

          assert.strictEqual(
            response.status,
            400,
            'returns 400 for invalid fields value',
          );
        });

        test('sparse fieldsets: fields without asData returns 400', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              ...buildFileDefQuery(),
              fields: { 'file-meta': ['name'] },
            });

          assert.strictEqual(
            response.status,
            400,
            'returns 400 when fields is specified without asData: true',
          );
        });

        test('query without fields returns all attributes (backward compat)', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(buildFileDefQuery());

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body as {
            data: {
              id?: string;
              type: string;
              attributes?: Record<string, any>;
            }[];
          };

          assert.ok(json.data.length > 0, 'results are returned');
          let entry = json.data.find((e) => e.id === `${realmHref}dir/foo.txt`);
          assert.ok(entry, 'expected entry is present');
          assert.ok(entry!.attributes, 'attributes are present');
          assert.ok(
            Object.keys(entry!.attributes!).length > 0,
            'attributes are populated when fields is not specified',
          );
          assert.notStrictEqual(
            entry!.attributes?.name,
            undefined,
            'name attribute is present',
          );
          assert.notStrictEqual(
            entry!.attributes?.url,
            undefined,
            'url attribute is present',
          );
        });

        test('sparse fieldsets for cards: empty fields returns card resources with no attributes', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              ...buildPersonQuery('Mango'),
              fields: { card: [] },
              asData: true,
            });

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body as {
            data: {
              id?: string;
              type: string;
              attributes?: Record<string, any>;
              meta?: Record<string, any>;
              links?: Record<string, any>;
            }[];
          };

          assert.strictEqual(json.data.length, 1, 'one result is returned');
          let entry = json.data[0];
          assert.strictEqual(entry.type, 'card', 'resource type is preserved');
          assert.ok(entry.id, 'resource id is preserved');
          assert.ok(entry.meta, 'resource meta is preserved');
          assert.deepEqual(
            entry.attributes,
            {},
            'attributes are empty when fields is empty array',
          );
        });

        test('sparse fieldsets for cards: specific fields returns only those attributes', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              ...buildPersonQuery('Mango'),
              fields: { card: ['firstName'] },
              asData: true,
            });

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body as {
            data: {
              id?: string;
              type: string;
              attributes?: Record<string, any>;
            }[];
          };

          assert.strictEqual(json.data.length, 1, 'one result is returned');
          let entry = json.data[0];
          let attrKeys = Object.keys(entry.attributes ?? {});
          assert.deepEqual(
            attrKeys,
            ['firstName'],
            'only requested field is present',
          );
          assert.strictEqual(
            entry.attributes?.firstName,
            'Mango',
            'firstName value is correct',
          );
        });

        test('sparse fieldsets for cards: query without fields returns all attributes', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(buildPersonQuery('Mango'));

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body as {
            data: {
              id?: string;
              type: string;
              attributes?: Record<string, any>;
            }[];
          };

          assert.strictEqual(json.data.length, 1, 'one result is returned');
          let entry = json.data[0];
          assert.ok(entry!.attributes, 'attributes are present');
          assert.ok(
            Object.keys(entry!.attributes!).length > 0,
            'attributes are populated when fields is not specified',
          );
          assert.strictEqual(
            entry.attributes?.firstName,
            'Mango',
            'firstName attribute is present',
          );
        });
      });
    });

    module('QUERY request (permissioned realm)', function (_hooks) {
      let query = () => buildPersonQuery('Mango');

      module('public readable realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read'],
          },
          realmURL: new URL('http://127.0.0.1:4444/test/'),
          onRealmSetup,
        });

        test('serves a /_search QUERY request', async function (assert) {
          let response = await request
            .post(searchPath)
            .send(query())
            .set('Accept', 'application/vnd.card+json')
            .set('Content-Type', 'application/json')
            .set('X-HTTP-Method-Override', 'QUERY'); // Use method override since supertest doesn't support QUERY directly

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            realmHref,
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
            `${realmHref}person-1`,
            'card ID is correct',
          );
          assert.strictEqual(json.meta.page.total, 1, 'total count is correct');
        });

        test('handles complex queries in request body', async function (assert) {
          let complexQuery = {
            filter: {
              on: {
                module: `${realmHref}person`,
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
                on: { module: `${realmHref}person`, name: 'Person' },
                direction: 'asc',
              },
            ],
          };

          let response = await request
            .post(searchPath)
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
            '@node-test_realm:localhost': ['read'],
          },
          realmURL: new URL('http://127.0.0.1:4444/test/'),
          onRealmSetup,
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer invalid-token`)
            .send(query());

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query()); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`)
            .send(query());

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            )
            .send(query());

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
        });
      });

      module('search query validation', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read'],
            '@node-test_realm:localhost': ['read'],
          },
          realmURL: new URL('http://127.0.0.1:4444/test/'),
          onRealmSetup,
        });

        test('400 with invalid query schema', async function (assert) {
          let response = await request
            .post(searchPath)
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
            .post(searchPath)
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
