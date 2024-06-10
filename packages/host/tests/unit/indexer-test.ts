import { module, test, skip } from 'qunit';

import { Indexer } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
// eslint-disable-next-line ember/no-test-import-export
import indexerTests from '@cardstack/runtime-common/tests/indexer-test';

import type SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

import { getDbAdapter } from '../helpers';

module('Unit | indexer', function (hooks) {
  let adapter: SQLiteAdapter;
  let indexer: Indexer;

  hooks.before(async function () {
    adapter = await getDbAdapter();
  });

  hooks.beforeEach(async function () {
    await adapter.reset();
    indexer = new Indexer(adapter);
    await indexer.ready();
  });

  test('can perform invalidations for a instance entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can perform invalidations for a module entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('only invalidates latest version of content', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can prevent concurrent batch invalidations from colliding', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can prevent concurrent batch invalidations from colliding when making new generation', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can update an index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can create a new generation of index entries', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can get an error doc', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can get "production" index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can get work in progress card', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('returns undefined when getting a deleted card', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can perform invalidations for an instance with deps more than a thousand', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can get compiled module and source when requested with file extension', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can get compiled module and source when requested without file extension', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can get compiled module and source from WIP index', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can get error doc for module', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('returns undefined when getting a deleted module', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  skip('TODO: cross realm invalidation');
});
