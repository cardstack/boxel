import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { __testOnlyUpsertTranspileCacheRow } from '@cardstack/runtime-common';

import type SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

import { getDbAdapter, testRealmURL } from '../helpers';

module('Unit | module-transpile-cache', function (hooks) {
  let adapter: SQLiteAdapter;
  setupTest(hooks);

  hooks.before(async function () {
    adapter = await getDbAdapter();
  });

  hooks.beforeEach(async function () {
    await adapter.reset();
  });

  test('UPSERT runs against sqlite and persists the row', async function (assert) {
    let canonicalPath = `${testRealmURL}example.gts`;
    let headers = {
      'Content-Type': 'application/javascript',
      'X-Boxel-Canonical-Path': canonicalPath,
    };
    let dependencyKeys = ['https://cardstack.com/base/card-api'];

    await __testOnlyUpsertTranspileCacheRow(adapter, {
      realmUrl: testRealmURL,
      canonicalPath,
      body: 'export const x = 1;',
      headers,
      dependencyKeys,
      capturedGeneration: 0,
    });

    let rows = (await adapter.execute(
      `SELECT body, headers, dependency_keys, generation
         FROM module_transpile_cache
        WHERE realm_url = $1 AND canonical_path = $2`,
      { bind: [testRealmURL, canonicalPath] },
    )) as {
      body: string;
      headers: string;
      dependency_keys: string;
      generation: number;
    }[];

    assert.strictEqual(rows.length, 1, 'one row was inserted');
    assert.strictEqual(rows[0].body, 'export const x = 1;', 'body persisted');
    assert.deepEqual(
      JSON.parse(rows[0].headers),
      headers,
      'headers persisted as JSON text',
    );
    assert.deepEqual(
      JSON.parse(rows[0].dependency_keys),
      dependencyKeys,
      'dependency_keys persisted as JSON text',
    );
    assert.strictEqual(Number(rows[0].generation), 0, 'generation persisted');
  });

  test('UPSERT on existing row updates body when EXCLUDED.generation >= current', async function (assert) {
    let canonicalPath = `${testRealmURL}example.gts`;
    let headers = { 'Content-Type': 'application/javascript' };

    await __testOnlyUpsertTranspileCacheRow(adapter, {
      realmUrl: testRealmURL,
      canonicalPath,
      body: 'first',
      headers,
      dependencyKeys: [],
      capturedGeneration: 0,
    });
    await __testOnlyUpsertTranspileCacheRow(adapter, {
      realmUrl: testRealmURL,
      canonicalPath,
      body: 'second',
      headers,
      dependencyKeys: [],
      capturedGeneration: 1,
    });

    let rows = (await adapter.execute(
      `SELECT body, generation FROM module_transpile_cache
        WHERE realm_url = $1 AND canonical_path = $2`,
      { bind: [testRealmURL, canonicalPath] },
    )) as { body: string; generation: number }[];

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].body, 'second', 'second write wins');
    assert.strictEqual(Number(rows[0].generation), 1);
  });
});
