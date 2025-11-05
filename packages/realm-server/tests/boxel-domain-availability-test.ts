import { module, test } from 'qunit';
import { basename, join } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type { User } from '@cardstack/runtime-common';
import { query, insert, asExpressions } from '@cardstack/runtime-common';
import {
  setupDB,
  insertUser,
  runTestRealmServer,
  createVirtualNetwork,
  matrixURL,
  closeServer,
  setupBaseRealmServer,
} from './helpers';
import type { RealmServerTokenClaim } from '../utils/jwt';
import { createJWT as createRealmServerJWT } from '../utils/jwt';
import { realmSecretSeed } from './helpers';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import type { Server } from 'http';
import { dirSync, type DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';

const testRealmURL = new URL('http://127.0.0.1:0/test/');

module(basename(__filename), function () {
  module('boxel domain availability endpoint', function (hooks) {
    setupBaseRealmServer(hooks, matrixURL);

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
        copySync(join(__dirname, 'cards'), testRealmDir);

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

    async function makeCheckBoxelDomainRequest(
      token: RealmServerTokenClaim | null,
      subdomain?: string,
    ) {
      let requestBuilder = request
        .get('/_check-boxel-domain-availability')
        .set('Accept', 'application/json');

      if (token) {
        const jwt = createRealmServerJWT(token, realmSecretSeed);
        requestBuilder = requestBuilder.set('Authorization', `Bearer ${jwt}`);
      }

      if (subdomain !== undefined) {
        requestBuilder = requestBuilder.query({ subdomain });
      }

      return await requestBuilder;
    }

    test('should return 422 when subdomain is missing', async function (assert) {
      const response = await makeCheckBoxelDomainRequest(defaultToken);

      assert.strictEqual(
        response.status,
        422,
        'Should return 422 for missing subdomain',
      );
      assert.ok(
        response.text.includes('subdomain query parameter is required'),
        'Should have error message about missing subdomain',
      );
    });

    test('should return 200 with error for invalid subdomains', async function (assert) {
      const invalidSubdomains = [
        'api',
        'admin',
        'test',
        'api-v2',
        'v1',
        '123',
        'my-api',
        'test-admin',
        'app-test',
        '',
        'a',
        'a'.repeat(64),
        'test@domain',
        'test.domain',
        '-test',
        'test-',
        'MyApp',
        'TEST',
        // Punycode/homoglyph attack protection
        'xn--test',
        'xn--example-123',
        'tëst', // non-ASCII character
        'test™', // trademark symbol
        'tеst', // Cyrillic 'e' (homoglyph)
      ];

      for (const subdomain of invalidSubdomains) {
        const response = await makeCheckBoxelDomainRequest(
          defaultToken,
          subdomain,
        );

        assert.strictEqual(
          response.status,
          200,
          `Should return 200 for invalid subdomain: ${subdomain}`,
        );

        const responseBody = response.body;
        assert.false(
          responseBody.available,
          `Should be unavailable for subdomain: ${subdomain}`,
        );
        assert.ok(
          responseBody.error,
          `Should have error message for subdomain: ${subdomain}`,
        );
      }
    });

    test('should return 200 with available=true for valid unclaimed subdomains', async function (assert) {
      const validSubdomains = ['mike', 'my-company'];

      for (const subdomain of validSubdomains) {
        const response = await makeCheckBoxelDomainRequest(
          defaultToken,
          subdomain,
        );

        assert.strictEqual(
          response.status,
          200,
          `Should return 200 for valid subdomain: ${subdomain}`,
        );

        const responseBody = response.body;
        assert.ok(
          responseBody,
          `Should have response body for subdomain: ${subdomain}`,
        );
        assert.true(
          responseBody.available,
          `Should be available for subdomain: ${subdomain}`,
        );
        assert.strictEqual(
          responseBody.error,
          undefined,
          `Should not have error for valid subdomain: ${subdomain}`,
        );
        assert.ok(
          responseBody.hostname,
          `Should have hostname for subdomain: ${subdomain}`,
        );
        assert.ok(
          responseBody.hostname.includes(subdomain),
          `Hostname should contain subdomain: ${subdomain}`,
        );
      }
    });

    test('should return 200 with available=false for claimed subdomains', async function (assert) {
      const subdomain = 'claimed-site';
      const hostname = `${subdomain}.${boxelSiteDomain}`;

      let { valueExpressions, nameExpressions: nameExpressions } =
        asExpressions({
          user_id: user.id,
          source_realm_url: `https://${boxelSiteDomain}/test-realm`,
          hostname: hostname,
          claimed_at: Math.floor(Date.now() / 1000),
        });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const response = await makeCheckBoxelDomainRequest(
        defaultToken,
        subdomain,
      );

      assert.strictEqual(
        response.status,
        200,
        'Should return 200 for claimed subdomain',
      );

      const responseBody = response.body;
      assert.ok(responseBody, 'Should have response body');
      assert.false(
        responseBody.available,
        'Should be unavailable for claimed subdomain',
      );
      assert.strictEqual(
        responseBody.error,
        undefined,
        'Should not have error for claimed subdomain',
      );
      assert.strictEqual(
        responseBody.hostname,
        hostname,
        'Should return correct hostname',
      );
    });

    test('should return available=true for removed/unclaimed subdomains', async function (assert) {
      const subdomain = 'removed-site';
      const hostname = `${subdomain}.${boxelSiteDomain}`;

      // Insert a claimed domain that has been removed
      let { valueExpressions, nameExpressions } = asExpressions({
        user_id: user.id,
        source_realm_url: `https://${boxelSiteDomain}/test-realm`,
        hostname: hostname,
        claimed_at: Math.floor(Date.now() / 1000) - 86400, // claimed yesterday
        removed_at: Math.floor(Date.now() / 1000), // removed now
      });
      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const response = await makeCheckBoxelDomainRequest(
        defaultToken,
        subdomain,
      );

      assert.strictEqual(
        response.status,
        200,
        'Should return 200 for removed subdomain',
      );

      const responseBody = response.body;
      assert.ok(responseBody, 'Should have response body');
      assert.true(
        responseBody.available,
        'Should be available for removed subdomain',
      );
      assert.strictEqual(
        responseBody.error,
        undefined,
        'Should not have error for removed subdomain',
      );
      assert.ok(
        responseBody.hostname.includes(subdomain),
        'Should return hostname with subdomain',
      );
    });
  });
});
