import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';
import { IndexWriter, IndexQueryEngine } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import PgAdapter from '../pg-adapter';
import indexWriterTests from '@cardstack/runtime-common/tests/index-writer-test';

module('index-writer', function (hooks) {
  let adapter: PgAdapter;
  let indexWriter: IndexWriter;
  let indexQueryEngine: IndexQueryEngine;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = new PgAdapter();
    indexWriter = new IndexWriter(adapter);
    indexQueryEngine = new IndexQueryEngine(adapter);
  });

  hooks.afterEach(async function () {
    await adapter.close();
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

  test('can update an index entry', async function (assert) {
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

  test('update realm meta when indexing is done', async function (assert) {
    await runSharedTest(indexWriterTests, assert, {
      indexWriter,
      indexQueryEngine,
      adapter,
    });
  });
});
