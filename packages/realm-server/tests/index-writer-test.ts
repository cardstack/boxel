import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';
import { IndexWriter, IndexQueryEngine } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import { PgAdapter } from '@cardstack/postgres';
import indexWriterTests from '@cardstack/runtime-common/tests/index-writer-test';
import { basename } from 'path';

module(basename(__filename), function () {
  module('index-writer', function (hooks) {
    let adapter: PgAdapter;
    let indexWriter: IndexWriter;
    let indexQueryEngine: IndexQueryEngine;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = new PgAdapter({ autoMigrate: true });
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

    test("invalidations don't cross realm boundaries", async function (assert) {
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

    test('can copy index entries', async function (assert) {
      await runSharedTest(indexWriterTests, assert, {
        indexWriter,
        indexQueryEngine,
        adapter,
      });
    });

    test('throws when copy source realm is not present on the realm server', async function (assert) {
      await runSharedTest(indexWriterTests, assert, {
        indexWriter,
        indexQueryEngine,
        adapter,
      });
    });

    test('error entry includes last known good state when available', async function (assert) {
      await runSharedTest(indexWriterTests, assert, {
        indexWriter,
        indexQueryEngine,
        adapter,
      });
    });

    test('error entry does not include last known good state when not available', async function (assert) {
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
});
