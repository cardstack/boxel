import { module, test } from 'qunit';
import { basename, join } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { query, param } from '@cardstack/runtime-common';
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
const ownerUserId = 'matrix-owner-id';
const sourceRealmURL = 'https://test-realm.example/owner/my-realm/';

module(basename(__filename), function () {
  module('unlisted realm path endpoint', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;
    let defaultToken: RealmServerTokenClaim;

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
      assert.strictEqual(
        rows[0].slug,
        a.body.data.attributes.slug,
        'the persisted slug matches what both requests returned',
      );
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
