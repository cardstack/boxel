import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';
import { IndexUpdater, IndexQueryEngine } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import PgAdapter from '../pg-adapter';
import indexUpdaterTests from '@cardstack/runtime-common/tests/index-updater-test';

module('index-updater', function (hooks) {
  let adapter: PgAdapter;
  let indexUpdater: IndexUpdater;
  let indexQueryEngine: IndexQueryEngine;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = new PgAdapter();
    indexUpdater = new IndexUpdater(adapter);
    indexQueryEngine = new IndexQueryEngine(adapter);
  });

  hooks.afterEach(async function () {
    await adapter.close();
  });

  test('can perform invalidations for a instance entry', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can perform invalidations for a module entry', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('only invalidates latest version of content', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can prevent concurrent batch invalidations from colliding', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can prevent concurrent batch invalidations from colliding when making new generation', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can update an index entry', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can create a new generation of index entries', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get an error doc', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get "production" index entry', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get work in progress card', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('returns undefined when getting a deleted card', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can perform invalidations for an instance with deps more than a thousand', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get compiled module and source when requested with file extension', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get compiled module and source when requested without file extension', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get compiled module and source from WIP index', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get error doc for module', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('returns undefined when getting a deleted module', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get css when requested with file extension', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get css when requested without file extension', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get css from WIP index', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('can get error doc for css', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });

  test('returns undefined when getting deleted css', async function (assert) {
    await runSharedTest(indexUpdaterTests, assert, {
      indexUpdater,
      indexQueryEngine,
      adapter,
    });
  });
});
