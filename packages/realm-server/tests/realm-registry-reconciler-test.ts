import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import { asExpressions, insert, query } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';
import {
  RealmRegistryReconciler,
  type RealmRegistryRow,
} from '../lib/realm-registry-reconciler.ts';

// Minimal fake `Realm` — we only care about `.url` and the unsubscribe()
// stub. Reconciler treats Realm as opaque except for the URL it uses as
// the map key.
function makeFakeRealm(url: string): Realm {
  return {
    url,
    start: async () => {},
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

async function deleteRow(dbAdapter: PgAdapter, url: string) {
  await query(dbAdapter, [
    `DELETE FROM realm_registry WHERE url = '${url.replace(/'/g, "''")}'`,
  ]);
}

module(basename(__filename), function () {
  module('RealmRegistryReconciler', function (hooks) {
    let dbAdapter: PgAdapter;
    let mountCalls: string[];
    let unmountCalls: string[];
    let reconciler: RealmRegistryReconciler;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
        mountCalls = [];
        unmountCalls = [];
        reconciler = new RealmRegistryReconciler({
          dbAdapter,
          prepareRealmFromRow: (row) => {
            mountCalls.push(row.url);
            return makeFakeRealm(row.url);
          },
          unmount: async (realm) => {
            unmountCalls.push(realm.url);
          },
          // Short poll for tests, though we drive reconcile() manually
          // rather than starting the loop.
          pollIntervalMs: 1000,
        });
      },
    });

    test('reconcile populates knownByUrl from the registry', async function (assert) {
      await seedRow(dbAdapter, {
        url: 'http://localhost:4201/luke/src/',
        kind: 'source',
        disk_id: 'luke/src',
        owner_username: 'luke',
      });
      await seedRow(dbAdapter, {
        url: '@cardstack/base/',
        kind: 'bootstrap',
        disk_id: '/abs/base',
        owner_username: 'system',
        pinned: true,
      });

      await reconciler.reconcile();

      assert.strictEqual(reconciler.knownByUrl.size, 2);
      assert.strictEqual(
        reconciler.knownByUrl.get('http://localhost:4201/luke/src/')?.kind,
        'source',
      );
      assert.strictEqual(
        reconciler.knownByUrl.get('@cardstack/base/')?.kind,
        'bootstrap',
      );
      assert.true(reconciler.knownByUrl.get('@cardstack/base/')!.pinned);
    });

    test('reconcile eagerly mounts pinned rows', async function (assert) {
      await seedRow(dbAdapter, {
        url: '@cardstack/base/',
        kind: 'bootstrap',
        disk_id: '/abs/base',
        owner_username: 'system',
        pinned: true,
      });

      await reconciler.reconcile();

      assert.deepEqual(mountCalls, ['@cardstack/base/']);
      assert.strictEqual(reconciler.mounted.size, 1);
      assert.ok(reconciler.mounted.get('@cardstack/base/'));
    });

    test('reconcile does NOT eagerly mount unpinned rows', async function (assert) {
      // Phase 3: source/published realms wait for first-request mount.
      await seedRow(dbAdapter, {
        url: 'http://localhost:4201/luke/src/',
        kind: 'source',
        disk_id: 'luke/src',
        owner_username: 'luke',
      });

      await reconciler.reconcile();

      assert.deepEqual(
        mountCalls,
        [],
        'mountFromRow not called for unpinned rows during reconcile',
      );
      assert.strictEqual(
        reconciler.mounted.size,
        0,
        'mounted map empty — non-pinned rows wait for lookupOrMount()',
      );
      assert.strictEqual(
        reconciler.knownByUrl.size,
        1,
        'knownByUrl still tracks the row so lookupOrMount() can find it',
      );
    });

    test('registerExistingMounts suppresses re-mount for pinned realms the legacy path already mounted', async function (assert) {
      const url = '@cardstack/base/';
      await seedRow(dbAdapter, {
        url,
        kind: 'bootstrap',
        disk_id: '/abs/base',
        owner_username: 'system',
        pinned: true,
      });

      reconciler.registerExistingMounts([makeFakeRealm(url)]);
      await reconciler.reconcile();

      assert.deepEqual(
        mountCalls,
        [],
        'mountFromRow not called because URL was already registered as mounted',
      );
      assert.strictEqual(reconciler.mounted.size, 1);
    });

    test('does NOT unmount legacy-registered mounts when they are absent from the registry', async function (assert) {
      // Simulates the multi-instance race where this instance skipped its
      // backfill (peer holds the advisory lock) and sees a registry that
      // doesn't (yet) include realms the legacy loadRealms path already
      // mounted. The reconciler must preserve those — their lifecycle
      // belongs to the legacy handler path in Phase 2.
      const legacyUrl = 'http://localhost:4201/luke/legacy/';
      reconciler.registerExistingMounts([makeFakeRealm(legacyUrl)]);

      // Registry is empty — no matching row for the legacy realm.
      await reconciler.reconcile();

      assert.deepEqual(
        unmountCalls,
        [],
        'legacy-registered mount was not torn down despite missing registry row',
      );
      assert.ok(
        reconciler.mounted.has(legacyUrl),
        'legacy mount still in mounted map',
      );
    });

    test('reconcile unmounts realms whose registry rows have been deleted', async function (assert) {
      // Use a non-pinned row mounted on demand via lookupOrMount() to
      // exercise the reconciler-owned unmount path under Phase 3 semantics.
      const url = 'http://localhost:4201/luke/src/';
      await seedRow(dbAdapter, {
        url,
        kind: 'source',
        disk_id: 'luke/src',
        owner_username: 'luke',
      });
      await reconciler.reconcile();
      assert.strictEqual(
        reconciler.mounted.size,
        0,
        'unpinned row not eager-mounted',
      );

      // Trigger first-request mount.
      await reconciler.lookupOrMount(url);
      assert.strictEqual(
        reconciler.mounted.size,
        1,
        'lookupOrMount mounted the row on demand',
      );

      await deleteRow(dbAdapter, url);
      await reconciler.reconcile();

      assert.deepEqual(unmountCalls, [url], 'unmount called for removed row');
      assert.strictEqual(reconciler.mounted.size, 0, 'mounted map cleared');
    });

    test('ensureMounted dedupes concurrent callers for the same URL', async function (assert) {
      let resolveStart: (() => void) | undefined;
      const startPromise = new Promise<void>((r) => {
        resolveStart = r;
      });
      let prepareInvocations = 0;
      const slowStartingRealm = (url: string): Realm =>
        ({
          url,
          start: async () => {
            await startPromise;
          },
          unsubscribe() {},
          handle: null,
        }) as unknown as Realm;
      const localReconciler = new RealmRegistryReconciler({
        dbAdapter,
        prepareRealmFromRow: (row) => {
          prepareInvocations += 1;
          return slowStartingRealm(row.url);
        },
        unmount: async () => {},
      });

      const row: RealmRegistryRow = {
        id: 'x',
        url: 'http://localhost:4201/foo/',
        kind: 'source',
        disk_id: 'foo',
        owner_username: 'foo',
        source_url: null,
        last_published_at: null,
        pinned: false,
      };
      const p1 = localReconciler.ensureMounted(row);
      const p2 = localReconciler.ensureMounted(row);
      assert.strictEqual(
        prepareInvocations,
        1,
        'only one prepareRealmFromRow invocation — second caller dedupes via mounted',
      );

      resolveStart!();
      const [r1, r2] = await Promise.all([p1, p2]);
      assert.strictEqual(
        r1,
        r2,
        'both callers receive the same Realm instance',
      );
      assert.strictEqual(
        prepareInvocations,
        1,
        'still only one prepare invocation after settle',
      );
    });

    test('ensureMounted clears mounted+pendingMounts so a retry after start() failure fires a fresh mount', async function (assert) {
      let attempt = 0;
      const flakyRealm = (url: string): Realm =>
        ({
          url,
          start: async () => {
            attempt += 1;
            if (attempt === 1) {
              throw new Error('transient start failure');
            }
          },
          unsubscribe() {},
          handle: null,
        }) as unknown as Realm;
      const localReconciler = new RealmRegistryReconciler({
        dbAdapter,
        prepareRealmFromRow: (row) => flakyRealm(row.url),
        unmount: async () => {},
      });

      const row: RealmRegistryRow = {
        id: 'x',
        url: 'http://localhost:4201/retry/',
        kind: 'source',
        disk_id: 'retry',
        owner_username: 'foo',
        source_url: null,
        last_published_at: null,
        pinned: false,
      };

      await assert.rejects(
        localReconciler.ensureMounted(row),
        /transient start failure/,
      );
      assert.strictEqual(
        localReconciler.pendingMounts.size,
        0,
        'pendingMounts cleared after failure',
      );

      const realm = await localReconciler.ensureMounted(row);
      assert.ok(realm, 'retry succeeded');
      assert.strictEqual(attempt, 2, 'realm.start() invoked a second time');
    });

    test('reconcile failure in one pinned row does not prevent mounting the others', async function (assert) {
      const localReconciler = new RealmRegistryReconciler({
        dbAdapter,
        prepareRealmFromRow: (row) => {
          if (row.url.includes('bad')) {
            throw new Error('prepare blew up');
          }
          return makeFakeRealm(row.url);
        },
        unmount: async () => {},
      });

      await seedRow(dbAdapter, {
        url: 'https://cardstack.com/bad/',
        kind: 'bootstrap',
        disk_id: '/abs/bad',
        owner_username: 'system',
        pinned: true,
      });
      await seedRow(dbAdapter, {
        url: 'https://cardstack.com/good/',
        kind: 'bootstrap',
        disk_id: '/abs/good',
        owner_username: 'system',
        pinned: true,
      });

      await localReconciler.reconcile();

      assert.ok(
        localReconciler.mounted.has('https://cardstack.com/good/'),
        'good row mounted despite sibling failure',
      );
      assert.notOk(
        localReconciler.mounted.has('https://cardstack.com/bad/'),
        'bad row not mounted',
      );
    });

    test('lookupOrMount returns mounted realm without re-mount', async function (assert) {
      const url = '@cardstack/base/';
      await seedRow(dbAdapter, {
        url,
        kind: 'bootstrap',
        disk_id: '/abs/base',
        owner_username: 'system',
        pinned: true,
      });
      await reconciler.reconcile();
      assert.strictEqual(mountCalls.length, 1, 'eager mount during reconcile');

      const realm = await reconciler.lookupOrMount(url);

      assert.ok(realm, 'realm returned');
      assert.strictEqual(realm!.url, url);
      assert.strictEqual(
        mountCalls.length,
        1,
        'no extra mount call — already-mounted realm returned directly',
      );
    });

    test('lookupOrMount mounts unpinned row on first request via knownByUrl', async function (assert) {
      const url = 'http://localhost:4201/luke/src/';
      await seedRow(dbAdapter, {
        url,
        kind: 'source',
        disk_id: 'luke/src',
        owner_username: 'luke',
      });
      // Reconcile first so knownByUrl is populated but row is not eager-mounted.
      await reconciler.reconcile();
      assert.strictEqual(reconciler.mounted.size, 0);

      const realm = await reconciler.lookupOrMount(url);

      assert.ok(realm, 'realm mounted on demand');
      assert.deepEqual(mountCalls, [url]);
      assert.strictEqual(reconciler.mounted.size, 1);
    });

    test('lookupOrMount falls back to a direct DB lookup when knownByUrl is stale', async function (assert) {
      // Simulates a request arriving on this instance for a freshly-published
      // realm before the next reconcile poll picks it up.
      const url = 'http://localhost:4201/luke/fresh/';
      await seedRow(dbAdapter, {
        url,
        kind: 'source',
        disk_id: 'luke/fresh',
        owner_username: 'luke',
      });
      // Note: NO reconcile() call — knownByUrl is empty.
      assert.strictEqual(reconciler.knownByUrl.size, 0);

      const realm = await reconciler.lookupOrMount(url);

      assert.ok(realm, 'realm mounted via direct DB lookup');
      assert.deepEqual(mountCalls, [url]);
      assert.strictEqual(
        reconciler.knownByUrl.size,
        1,
        'lookupOrMount cached the row in knownByUrl',
      );
    });

    test('lookupOrMount returns undefined for an unknown URL', async function (assert) {
      const realm = await reconciler.lookupOrMount(
        'http://localhost:4201/never/existed/',
      );
      assert.strictEqual(realm, undefined);
      assert.deepEqual(mountCalls, []);
    });
  });
});
