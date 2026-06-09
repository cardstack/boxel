import { module, test } from 'qunit';
import { basename } from 'path';
import { dirSync } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import { asExpressions, insert, query } from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';
import {
  RealmRegistryReconciler,
  type RealmRegistryRow,
} from '../lib/realm-registry-reconciler.ts';
import { RealmServer } from '../server.ts';

// Phase 3 PR 1 lazy-mount integration tests.
//
// These exercise the boot path (server.start() → reconciler.reconcile())
// and the request-path resolver (RealmServer.findOrMountRealm via the
// testing-only accessor) against a real PgAdapter so the realm_registry
// SQL surface is real, but with a stubbed mountFromRow that returns fake
// Realms so we don't spin up indexing / matrix / virtualNetwork.

function fakeRealm(url: string): Realm {
  return {
    url,
    paths: { local: () => '' },
    start: async () => {},
    unsubscribe() {},
    handle: null,
  } as unknown as Realm;
}

function fakeRealmWithFailingStart(url: string): Realm {
  return {
    url,
    paths: { local: () => '' },
    start: async () => {
      throw new Error(`simulated start failure for ${url}`);
    },
    unsubscribe() {},
    handle: null,
  } as unknown as Realm;
}

async function seedRow(
  dbAdapter: PgAdapter,
  row: Partial<RealmRegistryRow> & {
    url: string;
    kind: RealmRegistryRow['kind'];
    disk_id: string;
    owner_username: string;
  },
) {
  const { nameExpressions, valueExpressions } = asExpressions({
    url: row.url,
    kind: row.kind,
    disk_id: row.disk_id,
    owner_username: row.owner_username,
    source_url: row.source_url ?? null,
    last_published_at: row.last_published_at ?? null,
    pinned: row.pinned ?? false,
  });
  await query(
    dbAdapter,
    insert('realm_registry', nameExpressions, valueExpressions),
  );
}

function buildServer(opts: {
  dbAdapter: PgAdapter;
  reconciler: RealmRegistryReconciler;
  realms: Realm[];
}): RealmServer {
  const tempDir = dirSync({ unsafeCleanup: true });
  return new RealmServer({
    serverURL: new URL('http://127.0.0.1:4448'),
    realms: opts.realms,
    reconciler: opts.reconciler,
    virtualNetwork: {} as any,
    matrixClient: { matrixURL: new URL('http://localhost:8008/') } as any,
    realmServerSecretSeed: 'test-realm-server-secret',
    realmSecretSeed: 'test-realm-secret',
    grafanaSecret: 'test-grafana-secret',
    realmsRootPath: tempDir.name,
    dbAdapter: opts.dbAdapter,
    queue: {} as any,
    definitionLookup: {} as any,
    assetsURL: new URL('http://example.com/notional-assets-host/'),
    matrixRegistrationSecret: 'test-matrix-registration-secret',
    getIndexHTML: async () => '<html></html>',
  });
}

module(basename(__filename), function () {
  module('Phase 3 lazy mount', function (hooks) {
    let dbAdapter: PgAdapter;
    let mountCalls: string[];
    let mountFailures: Set<string>;
    let realms: Realm[];
    let reconciler: RealmRegistryReconciler;
    let server: RealmServer;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
        mountCalls = [];
        mountFailures = new Set();
        realms = [];
        reconciler = new RealmRegistryReconciler({
          dbAdapter,
          prepareRealmFromRow: (row) => {
            mountCalls.push(row.url);
            const r = mountFailures.has(row.url)
              ? fakeRealmWithFailingStart(row.url)
              : fakeRealm(row.url);
            realms.push(r);
            return r;
          },
          unmount: async (r) => {
            const idx = realms.indexOf(r);
            if (idx >= 0) {
              realms.splice(idx, 1);
            }
          },
          // Tests drive reconcile() manually; never start the background
          // poll loop — keeps tests fast and deterministic.
          pollIntervalMs: 1_000_000,
        });
        server = buildServer({ dbAdapter, reconciler, realms });
      },
    });

    test('server.start() eager-mounts pinned rows only', async function (assert) {
      await seedRow(dbAdapter, {
        url: 'https://cardstack.com/base/',
        kind: 'bootstrap',
        disk_id: '/abs/base',
        owner_username: 'system',
        pinned: true,
      });
      await seedRow(dbAdapter, {
        url: 'http://127.0.0.1:4448/luke/src/',
        kind: 'source',
        disk_id: 'luke/src',
        owner_username: 'luke',
        pinned: false,
      });

      await server.start();

      assert.deepEqual(
        mountCalls,
        ['https://cardstack.com/base/'],
        'only the pinned bootstrap row was mounted at boot',
      );
      assert.strictEqual(
        reconciler.mounted.size,
        1,
        'mounted map only contains the pinned realm',
      );
      assert.strictEqual(
        reconciler.knownByUrl.size,
        2,
        'knownByUrl reflects the full registry — unpinned row tracked but not mounted',
      );
    });

    test('first request for a non-pinned realm triggers a cold mount', async function (assert) {
      await seedRow(dbAdapter, {
        url: 'http://127.0.0.1:4448/luke/src/',
        kind: 'source',
        disk_id: 'luke/src',
        owner_username: 'luke',
        pinned: false,
      });
      await server.start();

      // Before any request, the unpinned row is not mounted.
      assert.strictEqual(reconciler.mounted.size, 0);

      let realm = await server.testingOnlyFindOrMountRealm(
        new URL('http://127.0.0.1:4448/luke/src/some-card.json'),
      );

      assert.ok(realm, 'realm returned');
      assert.strictEqual(realm!.url, 'http://127.0.0.1:4448/luke/src/');
      assert.deepEqual(
        mountCalls,
        ['http://127.0.0.1:4448/luke/src/'],
        'mountFromRow invoked once for the cold first request',
      );
    });

    test('second request for the same realm hits the cached mount without re-mounting', async function (assert) {
      await seedRow(dbAdapter, {
        url: 'http://127.0.0.1:4448/luke/src/',
        kind: 'source',
        disk_id: 'luke/src',
        owner_username: 'luke',
        pinned: false,
      });
      await server.start();

      let url = new URL('http://127.0.0.1:4448/luke/src/card.json');
      let r1 = await server.testingOnlyFindOrMountRealm(url);
      let r2 = await server.testingOnlyFindOrMountRealm(url);

      assert.strictEqual(r1, r2, 'same Realm instance on warm path');
      assert.strictEqual(
        mountCalls.length,
        1,
        'mountFromRow only invoked on the cold first request',
      );
    });

    test('does not deadlock when an in-flight mount triggers a self-fetch through findOrMountRealm', async function (assert) {
      // Regression test for the Phase 3 boot deadlock: a pinned realm's
      // realm.start() awaits a from-scratch-index job; the worker
      // (separate process) HTTP-fetches `<realm>/_mtimes` from the same
      // realm-server; that request goes through findOrMountRealm. If the
      // resolver re-enters reconciler.ensureMounted() for the same URL
      // before mountFromRow has finished publishing, it gets the
      // in-flight promise — deadlocking the boot. main.ts's mountFromRow
      // is required to push the realm into realms[] BEFORE awaiting
      // realm.start(), and findOrMountRealm must check realms[] before
      // walking knownByUrl.
      const url = 'http://127.0.0.1:4448/luke/lazy/';
      await seedRow(dbAdapter, {
        url,
        kind: 'source',
        disk_id: 'luke/lazy',
        owner_username: 'luke',
        pinned: false,
      });
      await server.start();

      // prepareRealmFromRow publishes immediately. The fake realm's
      // start() awaits a deferred we resolve only AFTER a self-fetch
      // has completed.
      let releaseStart: (() => void) | undefined;
      let startPromise = new Promise<void>((r) => {
        releaseStart = r;
      });
      let publishedUrls: string[] = [];
      let dlReconciler = new RealmRegistryReconciler({
        dbAdapter,
        prepareRealmFromRow: (row) => {
          let r: Realm = {
            url: row.url,
            paths: { local: () => '' },
            start: async () => {
              await startPromise;
            },
            unsubscribe() {},
            handle: null,
          } as unknown as Realm;
          // Publish to the array (matching main.ts's Phase 3 ordering)
          // BEFORE realm.start() is awaited by ensureMounted.
          publishedUrls.push(row.url);
          realms.push(r);
          return r;
        },
        unmount: async () => {},
        pollIntervalMs: 1_000_000,
      });
      let dlServer = buildServer({
        dbAdapter,
        reconciler: dlReconciler,
        realms,
      });
      await dlReconciler.reconcile();

      // Kick off the cold mount — it'll hang on startPromise.
      let mountInProgress = dlServer.testingOnlyFindOrMountRealm(
        new URL(`${url}entry`),
      );
      // Yield once so the inner await reaches the deferred.
      await new Promise((r) => setImmediate(r));

      // Self-fetch arrives while the original mount is still pending.
      // Without the fix this would wedge on the same in-flight promise.
      let selfFetch = await dlServer.testingOnlyFindOrMountRealm(
        new URL(`${url}_mtimes`),
      );
      assert.ok(selfFetch, 'self-fetch resolves to the in-flight realm');
      assert.strictEqual(selfFetch!.url, url);
      assert.strictEqual(
        publishedUrls.length,
        1,
        'mountFromRow only invoked once — self-fetch hit realms[] fast path',
      );

      // Release the original mount so the test exits cleanly.
      releaseStart!();
      await mountInProgress;
    });

    test('mount failure propagates so the request handler can respond 5xx; next request retries', async function (assert) {
      const url = 'http://127.0.0.1:4448/luke/flaky/';
      await seedRow(dbAdapter, {
        url,
        kind: 'source',
        disk_id: 'luke/flaky',
        owner_username: 'luke',
        pinned: false,
      });
      await server.start();

      mountFailures.add(url);
      await assert.rejects(
        server.testingOnlyFindOrMountRealm(new URL(`${url}card.json`)),
        /simulated start failure/,
        'mount failure throws — caller (HTTP middleware) responds 5xx',
      );
      assert.strictEqual(reconciler.mounted.size, 0, 'no realm mounted');

      // Second request after the underlying issue is fixed: ensureMounted
      // cleared pendingMounts on settle, so a fresh mount is attempted.
      mountFailures.delete(url);
      let realm = await server.testingOnlyFindOrMountRealm(
        new URL(`${url}card.json`),
      );

      assert.ok(realm, 'retry succeeded');
      assert.strictEqual(
        mountCalls.length,
        2,
        'mountFromRow invoked twice — initial failure + retry',
      );
    });

    test('request for a URL not in the registry returns undefined (caller responds 404)', async function (assert) {
      await server.start();

      let realm = await server.testingOnlyFindOrMountRealm(
        new URL('http://127.0.0.1:4448/never/heard/of/'),
      );

      assert.strictEqual(realm, undefined);
      assert.deepEqual(mountCalls, [], 'no mount attempted');
    });

    test('after a reconcile pass picks up a freshly-inserted row, the request resolves', async function (assert) {
      // Simulates a newly-published realm whose registry row was inserted
      // by a peer instance. findOrMountRealm walks knownByUrl to find a
      // URL prefix match; the row needs to be in knownByUrl, populated
      // by reconcile() (driven on a peer instance by NOTIFY +
      // safety-net poll). Verifies the integration: insert a row AFTER
      // server.start(), run reconcile() to model NOTIFY arrival, then
      // confirm the request resolves and lazy-mounts.
      await server.start();
      assert.strictEqual(reconciler.knownByUrl.size, 0);

      const url = 'http://127.0.0.1:4448/peer/fresh/';
      await seedRow(dbAdapter, {
        url,
        kind: 'source',
        disk_id: 'peer/fresh',
        owner_username: 'peer',
        pinned: false,
      });
      // NOTIFY-driven reconcile (modelled by manually calling reconcile()
      // — the background loop is suppressed in this test for determinism).
      await reconciler.reconcile();

      let realm = await server.testingOnlyFindOrMountRealm(
        new URL(`${url}card.json`),
      );

      assert.ok(realm, 'request resolves after reconcile picks up the row');
      assert.strictEqual(realm!.url, url);
      assert.deepEqual(mountCalls, [url], 'cold-mounted on the request');
    });
  });
});
