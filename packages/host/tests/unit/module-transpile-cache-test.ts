import type { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import type { Realm } from '@cardstack/runtime-common';

import {
  getDbAdapter,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  testRealmURL,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

module('Unit | module-transpile-cache', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);
  setupRealmCacheTeardown(hooks);

  let realm: Realm;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    let result = await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({ mockMatrixUtils, contents: {} }),
    );
    realm = result.realm;
  });

  test('Realm.__testOnlyUpsertTranspileCacheRow persists a row via the production writer', async function (assert) {
    let canonicalPath = `${testRealmURL}example.gts`;
    let headers = {
      'Content-Type': 'application/javascript',
      'X-Boxel-Canonical-Path': canonicalPath,
    };
    let dependencyKeys = ['https://cardstack.com/base/card-api'];

    await realm.__testOnlyUpsertTranspileCacheRow({
      canonicalPath,
      body: 'export const x = 1;',
      headers,
      dependencyKeys,
      capturedGeneration: 0,
    });

    let adapter = await getDbAdapter();
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

    // The row's presence is the assertion that matters: if
    // #writeTranspileCacheRow's SQL chokes on SQLite the writer
    // swallows the error and the row never lands.
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

  test('a higher-generation UPSERT overwrites the existing row', async function (assert) {
    let canonicalPath = `${testRealmURL}example.gts`;
    let headers = { 'Content-Type': 'application/javascript' };

    await realm.__testOnlyUpsertTranspileCacheRow({
      canonicalPath,
      body: 'first',
      headers,
      dependencyKeys: [],
      capturedGeneration: 0,
    });
    await realm.__testOnlyUpsertTranspileCacheRow({
      canonicalPath,
      body: 'second',
      headers,
      dependencyKeys: [],
      capturedGeneration: 1,
    });

    let adapter = await getDbAdapter();
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
