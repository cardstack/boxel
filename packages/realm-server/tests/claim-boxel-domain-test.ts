import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type { User } from '@cardstack/runtime-common';
import { query, param, insert, asExpressions } from '@cardstack/runtime-common';
import {
  setupDB,
  insertUser,
  runTestRealmServer,
  createVirtualNetwork,
  fixtureDir,
  matrixURL,
  closeServer,
  realmSecretSeed,
} from './helpers/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import type { RealmHttpServer as Server } from '../server.ts';
import { dirSync, type DirResult } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;

const testRealmURL = new URL('http://127.0.0.1:0/test/');

module(basename(import.meta.filename), function () {
  module('claim boxel claimed domain endpoint', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;
    let user: User;
    let boxelSiteDomain = 'boxel.site';
    let defaultToken: RealmServerTokenClaim;

    hooks.beforeEach(async function () {
      dir = dirSync();
    });

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        let testRealmDir = join(dir.name, 'realm_server_5', 'test');
        ensureDirSync(testRealmDir);
        copySync(fixtureDir('simple'), testRealmDir);

        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_5'),
            realmURL: testRealmURL,
            dbAdapter,
            publisher,
            runner,
            matrixURL,
            domainsForPublishedRealms: { boxelSite: boxelSiteDomain },
          })
        ).testRealmHttpServer;
        request = supertest(testRealmServer);

        user = await insertUser(
          dbAdapter,
          'matrix-user-id',
          'test-user',
          'test-user@example.com',
        );
        defaultToken = {
          user: 'matrix-user-id',
          sessionRoom: 'test-session',
        };
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    async function makePostRequest(
      token: RealmServerTokenClaim | null,
      body?: any,
    ) {
      let requestBuilder = request
        .post('/_boxel-claimed-domains')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json');

      if (token) {
        const jwt = createRealmServerJWT(token, realmSecretSeed);
        requestBuilder = requestBuilder.set('Authorization', `Bearer ${jwt}`);
      }

      if (body !== undefined) {
        requestBuilder = requestBuilder.send(body);
      }

      return await requestBuilder;
    }

    function assertErrorIncludes(response: any, message: string) {
      return response.body.errors && response.body.errors[0].includes(message);
    }

    test('should return 400 when body is not valid JSON', async function (assert) {
      const response = await makePostRequest(defaultToken, 'invalid json{');

      assert.strictEqual(
        response.status,
        400,
        'Should return 400 for invalid JSON',
      );
      assert.ok(
        assertErrorIncludes(response, 'Request body is not valid JSON'),
        'Should have error message about invalid JSON',
      );
    });

    test('should return 400 for invalid JSON-API format', async function (assert) {
      const response = await makePostRequest(defaultToken, {
        hostname: 'test.boxel.site',
      });

      assert.strictEqual(
        response.status,
        400,
        'Should return 400 for invalid JSON-API',
      );
      assert.ok(
        assertErrorIncludes(response, 'json is missing "data" object'),
        'Should have error message about missing data object',
      );
    });

    test('should return 400 when source_realm_url is missing', async function (assert) {
      const response = await makePostRequest(defaultToken, {
        data: {
          type: 'claimed-domain',
          attributes: {
            hostname: 'test.boxel.site',
          },
        },
      });

      assert.strictEqual(
        response.status,
        400,
        'Should return 400 for missing source_realm_url',
      );
      assert.ok(
        assertErrorIncludes(response, 'source_realm_url is required'),
        'Should have error message about missing source_realm_url',
      );
    });

    test('should return 400 when hostname is missing', async function (assert) {
      const response = await makePostRequest(defaultToken, {
        data: {
          type: 'claimed-domain',
          attributes: {
            source_realm_url: 'https://test-realm.com',
          },
        },
      });

      assert.strictEqual(
        response.status,
        400,
        'Should return 400 for missing hostname',
      );
      assert.ok(
        assertErrorIncludes(response, 'hostname is required'),
        'Should have error message about missing hostname',
      );
    });

    test('should return 422 when hostname is just the domain without subdomain', async function (assert) {
      const response = await makePostRequest(defaultToken, {
        data: {
          type: 'claimed-domain',
          attributes: {
            source_realm_url: 'https://test-realm.com',
            hostname: boxelSiteDomain,
          },
        },
      });

      assert.strictEqual(
        response.status,
        422,
        'Should return 422 for hostname without subdomain',
      );
      assert.ok(
        assertErrorIncludes(response, 'Hostname must include a subdomain'),
        'Should have error message about missing subdomain',
      );
    });

    test('should return 422 when hostname does not end with the correct domain', async function (assert) {
      const response = await makePostRequest(defaultToken, {
        data: {
          type: 'claimed-domain',
          attributes: {
            source_realm_url: 'https://test-realm.com',
            hostname: 'something.not-boxel.site',
          },
        },
      });

      assert.strictEqual(
        response.status,
        422,
        'Should return 422 for incorrect domain',
      );
      assert.ok(
        assertErrorIncludes(response, `Hostname must end with .boxel.site`),
        'Should have error message about incorrect domain',
      );
    });

    test('should return 422 for invalid subdomain names', async function (assert) {
      const invalidSubdomains = [
        'api',
        'admin',
        'test',
        '-invalid',
        'invalid-',
        'a',
        'a'.repeat(64),
        'test@domain',
        'test.domain',
        'MyApp',
        'TEST',
        'xn--test',
        'tëst',
      ];

      for (const subdomain of invalidSubdomains) {
        const response = await makePostRequest(defaultToken, {
          data: {
            type: 'claimed-domain',
            attributes: {
              source_realm_url: 'https://test-realm.com',
              hostname: `${subdomain}.${boxelSiteDomain}`,
            },
          },
        });

        assert.strictEqual(
          response.status,
          422,
          `Should return 422 for invalid subdomain: ${subdomain}`,
        );
        assert.ok(
          response.body,
          `Should have error message for subdomain: ${subdomain}`,
        );
      }
    });

    test('should return 422 when hostname is already claimed', async function (assert) {
      const hostname = 'claimed-site.boxel.site';

      let { valueExpressions, nameExpressions } = asExpressions({
        user_id: user.id,
        source_realm_url: 'https://existing-realm.com',
        hostname: hostname,
        claimed_at: Math.floor(Date.now() / 1000),
      });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const response = await makePostRequest(defaultToken, {
        data: {
          type: 'claimed-domain',
          attributes: {
            source_realm_url: 'https://test-realm.com',
            hostname: hostname,
          },
        },
      });

      assert.strictEqual(
        response.status,
        422,
        'Should return 422 for already claimed hostname',
      );
      assert.ok(
        assertErrorIncludes(response, 'Hostname is already claimed'),
        'Should have error message about hostname already claimed',
      );
    });

    test('should successfully claim a valid hostname', async function (assert) {
      const hostname = 'my-site.boxel.site';
      const sourceRealmURL = 'https://test-realm.com';

      const response = await makePostRequest(defaultToken, {
        data: {
          type: 'claimed-domain',
          attributes: {
            source_realm_url: sourceRealmURL,
            hostname: hostname,
          },
        },
      });

      assert.strictEqual(
        response.status,
        201,
        'Should return 201 for successful claim',
      );

      // Check JSON-API response body
      assert.ok(response.body.data, 'Should have data object');
      assert.strictEqual(
        response.body.data.type,
        'claimed-domain',
        'Should have correct type',
      );
      assert.ok(response.body.data.id, 'Should have an ID');
      assert.strictEqual(
        response.body.data.attributes.hostname,
        hostname,
        'Should return normalized hostname',
      );
      assert.strictEqual(
        response.body.data.attributes.subdomain,
        'my-site',
        'Should return correct subdomain',
      );
      assert.strictEqual(
        response.body.data.attributes.sourceRealmURL,
        sourceRealmURL,
        'Should return source realm URL',
      );

      // Verify the claim was saved to database
      const claims = await query(dbAdapter, [
        `SELECT * FROM claimed_domains_for_sites WHERE hostname = '${hostname}'`,
      ]);
      assert.strictEqual(claims.length, 1, 'Should have one claim in database');
      assert.strictEqual(
        claims[0].user_id,
        user.id,
        'Should have correct user ID',
      );
      assert.strictEqual(
        claims[0].source_realm_url,
        sourceRealmURL,
        'Should have correct source realm URL',
      );
      assert.ok(claims[0].claimed_at, 'Should have claimed_at timestamp');
      assert.strictEqual(claims[0].removed_at, null, 'Should not be removed');
    });

    test('should allow claiming a hostname that was previously removed', async function (assert) {
      const hostname = 'removed-site.boxel.site';

      // Insert a removed claim
      let { valueExpressions, nameExpressions } = asExpressions({
        user_id: user.id,
        source_realm_url: 'https://old-realm.com',
        hostname: hostname,
        claimed_at: Math.floor(Date.now() / 1000) - 86400,
        removed_at: Math.floor(Date.now() / 1000) - 3600,
      });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const sourceRealmURL = 'https://new-realm.com';
      const response = await makePostRequest(defaultToken, {
        data: {
          type: 'claimed-domain',
          attributes: {
            source_realm_url: sourceRealmURL,
            hostname: hostname,
          },
        },
      });

      assert.strictEqual(
        response.status,
        201,
        'Should return 201 for successful claim of previously removed hostname',
      );

      // Verify the new claim was saved
      const claims = await query(dbAdapter, [
        `SELECT * FROM claimed_domains_for_sites WHERE hostname = '${hostname}' AND removed_at IS NULL`,
      ]);
      assert.strictEqual(claims.length, 1, 'Should have one active claim');
      assert.strictEqual(
        claims[0].source_realm_url,
        sourceRealmURL,
        'Should have new source realm URL',
      );
    });
  });

  module('unlisted realm path endpoint', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;
    let defaultToken: RealmServerTokenClaim;
    const ownerUserId = 'matrix-owner-id';
    const sourceRealmURL = 'https://test-realm.example/owner/my-realm/';

    hooks.beforeEach(async function () {
      dir = dirSync();
    });

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        let testRealmDir = join(dir.name, 'realm_server_unlisted', 'test');
        ensureDirSync(testRealmDir);
        copySync(fixtureDir('simple'), testRealmDir);

        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_unlisted'),
            realmURL: testRealmURL,
            dbAdapter,
            publisher,
            runner,
            matrixURL,
          })
        ).testRealmHttpServer;
        request = supertest(testRealmServer);

        await insertUser(
          dbAdapter,
          ownerUserId,
          'test-user',
          'test-user@example.com',
        );
        // Grant the caller realm-owner permission on the source realm so the
        // ownership check in the handler passes.
        await dbAdapter.execute(
          `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES ('${sourceRealmURL}', '${ownerUserId}', true, true, true)`,
        );
        defaultToken = { user: ownerUserId, sessionRoom: 'test-session' };
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    async function post(token: RealmServerTokenClaim | null, body?: any) {
      let builder = request
        .post('/_unlisted-realm-path')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json');
      if (token) {
        builder = builder.set(
          'Authorization',
          `Bearer ${createRealmServerJWT(token, realmSecretSeed)}`,
        );
      }
      if (body !== undefined) {
        builder = builder.send(body);
      }
      return await builder;
    }

    test('returns 400 when sourceRealmURL is missing', async function (assert) {
      let response = await post(defaultToken, {});
      assert.strictEqual(
        response.status,
        400,
        'rejects a request with no realm',
      );
    });

    test('returns 403 when the caller is not the realm owner', async function (assert) {
      let response = await post(defaultToken, {
        sourceRealmURL: 'https://test-realm.example/someone-else/realm/',
      });
      assert.strictEqual(
        response.status,
        403,
        'rejects a non-owner of the source realm',
      );
    });

    test('allocates and persists a server-generated slug', async function (assert) {
      let response = await post(defaultToken, { sourceRealmURL });
      assert.strictEqual(response.status, 200, 'allocates a slug');

      let slug = response.body.data.attributes.slug;
      assert.ok(
        /^[a-z0-9]+$/.test(slug),
        `slug is a random lowercase-alphanumeric string (${slug})`,
      );

      let rows = (await query(dbAdapter, [
        `SELECT slug FROM unlisted_realm_paths WHERE source_realm_url =`,
        param(sourceRealmURL),
      ])) as { slug: string }[];
      assert.strictEqual(rows.length, 1, 'one row is persisted');
      assert.strictEqual(rows[0].slug, slug, 'the persisted slug is returned');
    });

    test('returns the same slug on repeat requests', async function (assert) {
      let first = await post(defaultToken, { sourceRealmURL });
      let second = await post(defaultToken, { sourceRealmURL });
      assert.strictEqual(
        second.body.data.attributes.slug,
        first.body.data.attributes.slug,
        'allocation is idempotent without regenerate',
      );
    });

    test('concurrent first-time allocations converge on one slug', async function (assert) {
      // Two overlapping first-time requests must not clobber each other: both
      // get the slug that committed first, and only one row is persisted.
      let [a, b] = await Promise.all([
        post(defaultToken, { sourceRealmURL }),
        post(defaultToken, { sourceRealmURL }),
      ]);
      assert.strictEqual(a.status, 200, 'first request succeeds');
      assert.strictEqual(b.status, 200, 'second request succeeds');
      assert.strictEqual(
        b.body.data.attributes.slug,
        a.body.data.attributes.slug,
        'both requests return the same slug',
      );

      let rows = (await query(dbAdapter, [
        `SELECT slug FROM unlisted_realm_paths WHERE source_realm_url =`,
        param(sourceRealmURL),
      ])) as { slug: string }[];
      assert.strictEqual(rows.length, 1, 'only one row is persisted');
    });

    test('regenerate mints a new slug', async function (assert) {
      let first = await post(defaultToken, { sourceRealmURL });
      let regenerated = await post(defaultToken, {
        sourceRealmURL,
        regenerate: true,
      });
      assert.notStrictEqual(
        regenerated.body.data.attributes.slug,
        first.body.data.attributes.slug,
        'regenerate produces a different slug',
      );
    });
  });
});
