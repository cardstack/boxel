import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import mergeRelationshipsTests from '@cardstack/runtime-common/tests/merge-relationships-test';

module(basename(import.meta.filename), function () {
  module('mergeRelationships', function () {
    test('an empty relationship replaces a stored linksToMany', async function (assert) {
      await runSharedTest(mergeRelationshipsTests, assert, {});
    });

    test('an indexed member or a query-backed relationship is left as it is', async function (assert) {
      await runSharedTest(mergeRelationshipsTests, assert, {});
    });

    test('a cleared linksTo replaces the stored link whole', async function (assert) {
      await runSharedTest(mergeRelationshipsTests, assert, {});
    });

    test('a list replaces a stored linksToMany', async function (assert) {
      await runSharedTest(mergeRelationshipsTests, assert, {});
    });

    test('a field that changed between linksTo and linksToMany takes its new shape', async function (assert) {
      await runSharedTest(mergeRelationshipsTests, assert, {});
    });

    test('a linksTo named only by a local id keeps the stored link', async function (assert) {
      await runSharedTest(mergeRelationshipsTests, assert, {});
    });

    test('a relationship the patch leaves out is kept', async function (assert) {
      await runSharedTest(mergeRelationshipsTests, assert, {});
    });
  });
});
