import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import searchShapeTests from '@cardstack/runtime-common/tests/search-shape-test';

module(basename(import.meta.filename), function () {
  module('search query shape', function () {
    test('a filter-less query has no filter shape', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('a card-type filter renders its type ref', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('eq renders its field paths and not its values', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('contains renders its field paths and not its values', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('in renders its field paths and neither its members nor their count', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('range renders its bound operators and not its bounds', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('a full-text matches renders as the bare operator', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('connectives render their branches', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('a node constraining nothing renders as *', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('ancestor and field code refs render their derivation', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('structurally identical filters render identically however spelled', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('sort renders in precedence order and is not canonicalized', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('htmlQuery renders format and renderType', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('the descriptor reports the page, fieldset, scope and realms', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('the htmlQuery is reported only where the fieldset selects html', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('the shape hash folds the members that decide the work', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });

    test('the shape hash ignores what varies across requests of one query', async function (assert) {
      await runSharedTest(searchShapeTests, assert, {});
    });
  });
});
