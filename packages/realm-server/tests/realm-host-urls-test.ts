import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { Realm } from '@cardstack/runtime-common';
import { param, query, SupportedMimeType } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import type { RealmHttpServer as Server } from '../server.ts';
import { closeServer, setupPermissionedRealmCached } from './helpers/index.ts';
import { notifyHostURLsChanged, toRealmURL } from '../lib/realm-host-urls.ts';

module(basename(import.meta.filename), function () {
  module('toRealmURL', function () {
    let match = {
      hostURL: 'https://site.example.test/shop/',
      realmURL: 'https://realms.example.test/owner/store/',
      isCanonical: true,
    };

    test('keeps the path below the host URL, and the query', function (assert) {
      assert.strictEqual(
        toRealmURL(
          new URL('https://site.example.test/shop/products/1?x=y'),
          match,
        ).href,
        'https://realms.example.test/owner/store/products/1?x=y',
      );
    });

    test('maps the host URL without its trailing slash to the realm URL without one', function (assert) {
      assert.strictEqual(
        toRealmURL(new URL('https://site.example.test/shop'), match).href,
        'https://realms.example.test/owner/store',
      );
    });
  });

  module('requests on a host URL', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
    });

    setupPermissionedRealmCached(hooks, {
      permissions: { '*': ['read'] },
      fileSystem: { 'hello.txt': 'hello from the realm' },
      onRealmSetup(args) {
        testRealm = args.testRealm;
        testRealmHttpServer = args.testRealmHttpServer;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    // A registry row for a realm URL, so a host URL can name it. Returns the
    // row's id.
    async function register(url: string): Promise<string> {
      let rows = (await query(dbAdapter, [
        `INSERT INTO realm_registry (url, kind, disk_id, owner_username) VALUES (`,
        param(url),
        `, 'source', `,
        param(`test/${url}`),
        `, 'test-owner') ON CONFLICT (url) DO UPDATE SET url = EXCLUDED.url RETURNING id`,
      ])) as { id: string }[];
      return rows[0].id;
    }

    async function addHostURL(
      realmId: string,
      host: string,
      pathPrefix = '/',
      isCanonical = false,
    ): Promise<void> {
      await query(dbAdapter, [
        `INSERT INTO realm_host_urls (realm_id, kind, host, path_prefix, is_canonical, created_by) VALUES (`,
        param(realmId),
        `, 'site-name', `,
        param(host),
        `, `,
        param(pathPrefix),
        `, `,
        param(isCanonical),
        `, '@test-owner:localhost')`,
      ]);
    }

    function getSource(host: string, path: string) {
      return request
        .get(path)
        .set('Host', host)
        .set('Accept', SupportedMimeType.CardSource);
    }

    // A change is announced to the server's cache asynchronously, so wait for
    // the status the change should produce.
    async function statusOnceSettled(
      host: string,
      path: string,
      expected: number,
    ): Promise<number> {
      let status = (await getSource(host, path)).status;
      for (let attempt = 0; attempt < 50 && status !== expected; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        status = (await getSource(host, path)).status;
      }
      return status;
    }

    test('a host URL at the root of its host reaches its realm', async function (assert) {
      await addHostURL(await register(testRealm.url), 'site.example.test');

      let response = await getSource('site.example.test', '/hello.txt');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(response.text, 'hello from the realm');
    });

    test('a host URL with a path prefix reaches its realm only under the prefix', async function (assert) {
      await addHostURL(
        await register(testRealm.url),
        'space.example.test',
        '/shop/',
      );

      let underPrefix = await getSource(
        'space.example.test',
        '/shop/hello.txt',
      );
      assert.strictEqual(underPrefix.status, 200, 'served under the prefix');
      assert.strictEqual(underPrefix.text, 'hello from the realm');

      let outsidePrefix = await getSource(
        'space.example.test',
        '/other/hello.txt',
      );
      assert.strictEqual(outsidePrefix.status, 404, 'not served elsewhere');
    });

    test('the host URL with the longest path prefix wins', async function (assert) {
      let elsewhere = await register(`${testRealm.url}elsewhere/`);
      await addHostURL(elsewhere, 'nested.example.test', '/');
      await addHostURL(
        await register(testRealm.url),
        'nested.example.test',
        '/shop/',
      );

      let response = await getSource('nested.example.test', '/shop/hello.txt');
      assert.strictEqual(response.status, 200, 'the longer prefix is served');
      assert.strictEqual(response.text, 'hello from the realm');

      let shorter = await getSource('nested.example.test', '/hello.txt');
      assert.strictEqual(
        shorter.status,
        404,
        'the shorter prefix maps to the other realm, which has no such file',
      );
    });

    test('a host URL is resolved before the realm URL it shares a host with', async function (assert) {
      let realmHost = new URL(testRealm.url).host;
      let before = await getSource(realmHost, '/hello.txt');
      assert.strictEqual(before.status, 200, 'the realm serves its own URL');

      await addHostURL(
        await register(`${testRealm.url}elsewhere/`),
        realmHost,
        '/',
      );
      await notifyHostURLsChanged(dbAdapter, realmHost);

      assert.strictEqual(
        await statusOnceSettled(realmHost, '/hello.txt', 404),
        404,
        'the host URL now routes the request to the other realm',
      );
    });

    test('a removed host URL answers 404 once its change is announced', async function (assert) {
      await addHostURL(await register(testRealm.url), 'gone.example.test');
      let served = await getSource('gone.example.test', '/hello.txt');
      assert.strictEqual(served.status, 200, 'served while it exists');

      await query(dbAdapter, [
        `DELETE FROM realm_host_urls WHERE host =`,
        param('gone.example.test'),
      ]);
      await notifyHostURLsChanged(dbAdapter, 'gone.example.test');

      assert.strictEqual(
        await statusOnceSettled('gone.example.test', '/hello.txt', 404),
        404,
        'no longer served',
      );
    });

    test('deleting a realm deletes its host URLs', async function (assert) {
      let realmId = await register(`${testRealm.url}doomed/`);
      await addHostURL(realmId, 'doomed.example.test');

      await query(dbAdapter, [
        `DELETE FROM realm_registry WHERE id =`,
        param(realmId),
      ]);

      let rows = (await query(dbAdapter, [
        `SELECT count(*)::int AS count FROM realm_host_urls WHERE realm_id =`,
        param(realmId),
      ])) as { count: number }[];
      assert.strictEqual(rows[0].count, 0);
    });
  });
});
