import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  insertPermissions,
  param,
  permissionsExist,
  query,
  removeRealmPermissions,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';
import {
  deleteRegistryRowByUrl,
  insertSourceRealmInRegistry,
} from '../lib/realm-registry-writes.ts';

// CS-10898 regression test: an injected error after a registry-row delete
// (but before the lock-holder transaction commits) must roll back BOTH the
// registry-row delete AND the permissions delete. Pre-CS-10898 the handler
// ran each helper through the shared dbAdapter, so each DELETE committed in
// its own auto-tx and a mid-cleanup throw left the realm half-deleted.
module(basename(import.meta.filename), function () {
  module('CS-10898: realm cleanup transactionality', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    async function seedSourceRealm(
      realmURL: string,
      ownerUsername: string,
      diskId: string,
    ) {
      await insertSourceRealmInRegistry(dbAdapter, {
        url: realmURL,
        diskId,
        ownerUsername,
      });
      await insertPermissions(dbAdapter, new URL(realmURL), {
        [ownerUsername]: ['read', 'write', 'realm-owner'],
      });
    }

    async function registryRowExists(url: string): Promise<boolean> {
      const rows = (await query(dbAdapter, [
        `SELECT 1 AS found FROM realm_registry WHERE url =`,
        param(url),
      ])) as { found: number }[];
      return rows.length > 0;
    }

    test('a throw after deleteRegistryRowByUrl rolls the DELETE back', async function (assert) {
      const realmURL = 'http://localhost:4201/cs10898/rollback/';
      await seedSourceRealm(realmURL, '@cs10898:localhost', 'disk-rollback');

      // Sanity: pre-conditions hold.
      assert.true(await registryRowExists(realmURL), 'registry row seeded');
      assert.true(
        await permissionsExist(dbAdapter, new URL(realmURL)),
        'permissions seeded',
      );

      await assert.rejects(
        dbAdapter.withWriteLock(realmURL, async (txQuerier) => {
          // First DELETE — runs on the lock-holder's pinned querier so it
          // joins the BEGIN/COMMIT tx instead of auto-committing.
          await deleteRegistryRowByUrl(dbAdapter, realmURL, txQuerier);
          // Inject a mid-cleanup failure. Pre-CS-10898 the row above
          // would have committed in its own auto-tx and would still be
          // gone after the rollback below.
          throw new Error('injected mid-cleanup failure');
        }),
        /injected mid-cleanup failure/,
      );

      assert.true(
        await registryRowExists(realmURL),
        'registry row restored after rollback',
      );
      assert.true(
        await permissionsExist(dbAdapter, new URL(realmURL)),
        'permissions still present',
      );
    });

    test('a throw between two cleanup DELETEs rolls back BOTH', async function (assert) {
      const realmURL = 'http://localhost:4201/cs10898/both/';
      await seedSourceRealm(realmURL, '@cs10898both:localhost', 'disk-both');

      await assert.rejects(
        dbAdapter.withWriteLock(realmURL, async (txQuerier) => {
          await deleteRegistryRowByUrl(dbAdapter, realmURL, txQuerier);
          await removeRealmPermissions(dbAdapter, new URL(realmURL), txQuerier);
          // Throw after both DELETEs — both should roll back atomically.
          throw new Error('injected post-cleanup failure');
        }),
        /injected post-cleanup failure/,
      );

      assert.true(
        await registryRowExists(realmURL),
        'registry row restored after rollback',
      );
      assert.true(
        await permissionsExist(dbAdapter, new URL(realmURL)),
        'permissions restored after rollback',
      );
    });

    test('the happy path commits all cleanup DELETEs together', async function (assert) {
      const realmURL = 'http://localhost:4201/cs10898/commit/';
      await seedSourceRealm(realmURL, '@cs10898ok:localhost', 'disk-commit');

      await dbAdapter.withWriteLock(realmURL, async (txQuerier) => {
        await deleteRegistryRowByUrl(dbAdapter, realmURL, txQuerier);
        await removeRealmPermissions(dbAdapter, new URL(realmURL), txQuerier);
      });

      assert.false(
        await registryRowExists(realmURL),
        'registry row gone after successful commit',
      );
      assert.false(
        await permissionsExist(dbAdapter, new URL(realmURL)),
        'permissions gone after successful commit',
      );
    });
  });
});
