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
        remainingNames,
        originalNames,
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
      assert.strictEqual(
        (await attachedNames()).length,
        originalNames.length + 1,
      );
    });
  });
});
