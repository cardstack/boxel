import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import { asExpressions, insert, query } from '@cardstack/runtime-common';
import { setupDB } from './helpers';
import {
  RealmRegistryReconciler,
  type RealmRegistryRow,
} from '../lib/realm-registry-reconciler';

// Minimal fake `Realm` — we only care about `.url` and the unsubscribe()
// stub. Reconciler treats Realm as opaque except for the URL it uses as
// the map key.
function makeFakeRealm(url: string): Realm {
  return {
    url,
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
          mountFromRow: async (row) => {
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
        url: 'https://cardstack.com/base/',
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
        reconciler.knownByUrl.get('https://cardstack.com/base/')?.kind,
        'bootstrap',
      );
      assert.true(
        reconciler.knownByUrl.get('https://cardstack.com/base/')!.pinned,
      );
    });

    test('reconcile mounts rows absent from the mounted map', async function (assert) {
      await seedRow(dbAdapter, {
        url: 'http://localhost:4201/luke/src/',
        kind: 'source',
        disk_id: 'luke/src',
        owner_username: 'luke',
      });

      await reconciler.reconcile();

      assert.deepEqual(mountCalls, ['http://localhost:4201/luke/src/']);
      assert.strictEqual(reconciler.mounted.size, 1);
      assert.ok(reconciler.mounted.get('http://localhost:4201/luke/src/'));
    });

    test('registerExistingMounts suppresses re-mount for realms the legacy path already mounted', async function (assert) {
      const url = 'http://localhost:4201/luke/src/';
      await seedRow(dbAdapter, {
        url,
        kind: 'source',
        disk_id: 'luke/src',
        owner_username: 'luke',
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

    test('reconcile unmounts realms whose registry rows have been deleted', async function (assert) {
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
        1,
        'mounted after first reconcile',
      );

      await deleteRow(dbAdapter, url);
      await reconciler.reconcile();

      assert.deepEqual(unmountCalls, [url], 'unmount called for removed row');
      assert.strictEqual(reconciler.mounted.size, 0, 'mounted map cleared');
    });

    test('ensureMounted serializes concurrent callers for the same URL', async function (assert) {
      let resolveMount: ((r: Realm) => void) | undefined;
      let mountInvocations = 0;
      const localReconciler = new RealmRegistryReconciler({
        dbAdapter,
        mountFromRow: async (row) => {
          mountInvocations += 1;
          return await new Promise<Realm>((r) => {
            resolveMount = r;
          }).then(() => makeFakeRealm(row.url));
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
        mountInvocations,
        1,
        'only one mount invocation in flight',
      );

      resolveMount!(makeFakeRealm(row.url));
      const [r1, r2] = await Promise.all([p1, p2]);
      assert.strictEqual(
        r1,
        r2,
        'both callers receive the same Realm instance',
      );
      assert.strictEqual(
        mountInvocations,
        1,
        'still only one mount invocation after settle',
      );
    });

    test('ensureMounted clears pendingMounts so a retry after failure fires a fresh mount', async function (assert) {
      let attempt = 0;
      const localReconciler = new RealmRegistryReconciler({
        dbAdapter,
        mountFromRow: async (row) => {
          attempt += 1;
          if (attempt === 1) {
            throw new Error('transient failure');
          }
          return makeFakeRealm(row.url);
        },
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
        /transient failure/,
      );
      assert.strictEqual(
        localReconciler.pendingMounts.size,
        0,
        'pendingMounts cleared after failure',
      );

      const realm = await localReconciler.ensureMounted(row);
      assert.ok(realm, 'retry succeeded');
      assert.strictEqual(attempt, 2, 'mountFromRow invoked a second time');
    });

    test('reconcile failure in one row does not prevent mounting the others', async function (assert) {
      let failing = true;
      const localReconciler = new RealmRegistryReconciler({
        dbAdapter,
        mountFromRow: async (row) => {
          if (row.url.includes('bad')) {
            throw new Error('mount blew up');
          }
          return makeFakeRealm(row.url);
        },
        unmount: async () => {},
      });
      void failing;

      await seedRow(dbAdapter, {
        url: 'http://localhost:4201/luke/bad/',
        kind: 'source',
        disk_id: 'luke/bad',
        owner_username: 'luke',
      });
      await seedRow(dbAdapter, {
        url: 'http://localhost:4201/luke/good/',
        kind: 'source',
        disk_id: 'luke/good',
        owner_username: 'luke',
      });

      await localReconciler.reconcile();

      assert.ok(
        localReconciler.mounted.has('http://localhost:4201/luke/good/'),
        'good row mounted despite sibling failure',
      );
      assert.notOk(
        localReconciler.mounted.has('http://localhost:4201/luke/bad/'),
        'bad row not mounted',
      );
    });
  });
});
