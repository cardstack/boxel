import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';
import { Indexer } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import PgAdapter from '../pg-adapter';
import indexerTests from '@cardstack/runtime-common/tests/indexer-test';

module('indexer db client', function (hooks) {
  let adapter: PgAdapter;
  let indexer: Indexer;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = new PgAdapter();
    indexer = new Indexer(adapter);
    await indexer.ready();
  });

  hooks.afterEach(async function () {
    await indexer.teardown();
  });

  test('can perform invalidations for an index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('does not create invalidation record for non-JSON invalidation', async function (assert) {
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

  test('can remove an index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can create a new generation of index entries', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can get "production" index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('can get work in progress index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });

  test('returns undefined when getting a deleted entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { indexer, adapter });
  });
});
