import { module, test, skip } from 'qunit';

import { IndexWriter, IndexQueryEngine } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
// eslint-disable-next-line ember/no-test-import-export
import indexWriterTests from '@cardstack/runtime-common/tests/index-writer-test';

import type SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

import { getDbAdapter } from '../helpers';

module('Unit | index-writer', function (hooks) {
  let adapter: SQLiteAdapter;
  let indexWriter: IndexWriter;
  let indexQueryEngine: IndexQueryEngine;

  hooks.before(async function () {
    adapter = await getDbAdapter();
  });

  hooks.beforeEach(async function () {
    await adapter.reset();
    indexWriter = new IndexWriter(adapter);
    indexQueryEngine = new IndexQueryEngine(adapter);
  });

  test('can perform invalidations for a instance entry', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can perform invalidations for a module entry', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('only invalidates latest version of content', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can prevent concurrent batch invalidations from colliding', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can prevent concurrent batch invalidations from colliding when making new generation', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can update an index entry', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can create a new generation of index entries', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get an error doc', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get "production" index entry', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get work in progress card', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('returns undefined when getting a deleted card', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can perform invalidations for an instance with deps more than a thousand', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get compiled module and source when requested with file extension', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get compiled module and source when requested without file extension', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get compiled module and source from WIP index', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get error doc for module', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('returns undefined when getting a deleted module', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get css when requested with file extension', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get css when requested without file extension', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get css from WIP index', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get error doc for css', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  test('returns undefined when getting deleted css', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });

  skip('TODO: cross realm invalidation');
});
