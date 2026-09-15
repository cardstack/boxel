import { module, test } from 'qunit';

import type SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

import {
  getDbAdapter,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../helpers';

module('Unit | realm cache teardown', function (hooks) {
  let adapter: SQLiteAdapter;
  let originalNames: string[];
  let attachedNames = async () =>
    (
      await adapter.execute(
        'SELECT name FROM pragma_database_list ORDER BY name',
      )
    ).map((row) => String(row.name));

  hooks.before(async function () {
    adapter = await getDbAdapter();
    originalNames = await attachedNames();
  });

  // QUnit runs after hooks in reverse registration order.
  hooks.after(async function (assert) {
    let remainingNames = await attachedNames();
    try {
      assert.deepEqual(
        remainingNames.filter((name) => !originalNames.includes(name)),
        [],
        'parent teardown releases snapshots created by its nested module',
      );
    } finally {
      for (let name of remainingNames) {
        if (!originalNames.includes(name)) {
          await adapter.deleteSnapshot(name);
        }
      }
    }
  });

  setupRealmCacheTeardown(hooks);

  module('nested query fixture', function () {
    test('query snapshot is released when the parent module finishes', async function (assert) {
      await withCachedRealmSetup(async () => undefined);
      assert.true(
        (await attachedNames()).some((name) => !originalNames.includes(name)),
      );
    });

    test('query setup can cache twelve variants and restore the latest data', async function (assert) {
      let realmURL = 'https://snapshot-cache.test/';
      try {
        for (let generation = 0; generation < 12; generation++) {
          await adapter.execute(
            `INSERT INTO realm_generations (realm_url, current_generation)
             VALUES ($1, $2) ON CONFLICT (realm_url)
             DO UPDATE SET current_generation = excluded.current_generation`,
            { bind: [realmURL, generation] },
          );
          await withCachedRealmSetup(
            `variant-${generation}`,
            async () => undefined,
          );
        }
        await adapter.execute(
          'UPDATE realm_generations SET current_generation = 99 WHERE realm_url = $1',
          { bind: [realmURL] },
        );
        await withCachedRealmSetup('variant-11', async () => undefined);
        let [row] = await adapter.execute(
          'SELECT current_generation FROM realm_generations WHERE realm_url = $1',
          { bind: [realmURL] },
        );
        assert.strictEqual(
          Number(row.current_generation),
          11,
          'cached data is restored',
        );
      } finally {
        await adapter.execute(
          'DELETE FROM realm_generations WHERE realm_url = $1',
          {
            bind: [realmURL],
          },
        );
      }
    });
  });
});
