import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';
import { IndexerDBClient } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import PgAdapter from '../pg-adapter';
import indexerTests from '@cardstack/runtime-common/tests/indexer-test';

module('indexer db client', function (hooks) {
  let adapter: PgAdapter;
  let client: IndexerDBClient;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = new PgAdapter();
    client = new IndexerDBClient(adapter);
    await client.ready();
  });

  hooks.afterEach(async function () {
    await client.teardown();
  });

  test('can perform invalidations for an index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });

  test('does not create invalidation record for non-JSON invalidation', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });

  test('only invalidates latest version of content', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });

  test('can prevent concurrent batch invalidations from colliding', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });

  test('can prevent concurrent batch invalidations from colliding when making new generation', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });

  test('can update an index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });

  test('can remove an index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });

  test('can create a new generation of index entries', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });

  test('can get "production" index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });

  test('can get work in progress index entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });

  test('returns undefined when getting a deleted entry', async function (assert) {
    await runSharedTest(indexerTests, assert, { client, adapter });
  });
});
