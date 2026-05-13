import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { dbExpression, param, query } from '@cardstack/runtime-common';

import type SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

import { getDbAdapter, testRealmURL } from '../helpers';

// Mirrors Realm#writeTranspileCacheRow in packages/runtime-common/realm.ts.
// The production writer is private, so this test re-issues the same UPSERT
// shape to guarantee the SQL it produces is valid against the host's
// SQLiteAdapter. The earlier regression hard-coded '::jsonb' next to two
// param placeholders; on SQLite that landed as `$4 ::jsonb, $5 ::jsonb,`
// which the parser rejected on the leading `:`. The error was swallowed by
// the writer's best-effort try/catch and surfaced only as console noise.
async function upsertTranspileCacheRow(
  adapter: SQLiteAdapter,
  {
    realmUrl,
    canonicalPath,
    body,
    headers,
    dependencyKeys,
    generation,
  }: {
    realmUrl: string;
    canonicalPath: string;
    body: string;
    headers: Record<string, string>;
    dependencyKeys: string[];
    generation: number;
  },
) {
  await query(adapter, [
    'INSERT INTO module_transpile_cache',
    '(realm_url, canonical_path, body, headers, dependency_keys, generation, created_at)',
    'VALUES (',
    param(realmUrl),
    ',',
    param(canonicalPath),
    ',',
    param(body),
    ',',
    param(JSON.stringify(headers)),
    dbExpression({ pg: '::jsonb' }),
    ',',
    param(JSON.stringify(dependencyKeys)),
    dbExpression({ pg: '::jsonb' }),
    ',',
    param(generation),
    ',',
    param(Date.now()),
    ') ON CONFLICT (realm_url, canonical_path) DO UPDATE SET',
    'body = EXCLUDED.body,',
    'headers = EXCLUDED.headers,',
    'dependency_keys = EXCLUDED.dependency_keys,',
    'generation = EXCLUDED.generation,',
    'created_at = EXCLUDED.created_at',
    'WHERE module_transpile_cache.generation <= EXCLUDED.generation',
  ]);
}

module('Unit | module-transpile-cache', function (hooks) {
  let adapter: SQLiteAdapter;
  setupTest(hooks);

  hooks.before(async function () {
    adapter = await getDbAdapter();
  });

  hooks.beforeEach(async function () {
    await adapter.reset();
  });

  test('UPSERT in the shape used by Realm#writeTranspileCacheRow runs against sqlite', async function (assert) {
    let canonicalPath = `${testRealmURL}example.gts`;
    let headers = {
      'Content-Type': 'application/javascript',
      'X-Boxel-Canonical-Path': canonicalPath,
    };
    let dependencyKeys = ['https://cardstack.com/base/card-api'];

    await upsertTranspileCacheRow(adapter, {
      realmUrl: testRealmURL,
      canonicalPath,
      body: 'export const x = 1;',
      headers,
      dependencyKeys,
      generation: 0,
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

    await upsertTranspileCacheRow(adapter, {
      realmUrl: testRealmURL,
      canonicalPath,
      body: 'first',
      headers,
      dependencyKeys: [],
      generation: 0,
    });
    await upsertTranspileCacheRow(adapter, {
      realmUrl: testRealmURL,
      canonicalPath,
      body: 'second',
      headers,
      dependencyKeys: [],
      generation: 1,
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
