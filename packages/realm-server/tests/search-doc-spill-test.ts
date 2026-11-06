import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import searchDocSpillTests from '@cardstack/runtime-common/tests/search-doc-spill-test';

module(basename(import.meta.filename), function () {
  module('search doc spill', function () {
    test('a doc that fits inline is promoted whole', async function (assert) {
      await runSharedTest(searchDocSpillTests, assert, {});
    });

    test('a large doc spills its large values, wherever they are', async function (assert) {
      await runSharedTest(searchDocSpillTests, assert, {});
    });

    test('unspilling restores the original doc', async function (assert) {
      await runSharedTest(searchDocSpillTests, assert, {});
    });

    test('the same value gets the same ref every time it is indexed', async function (assert) {
      await runSharedTest(searchDocSpillTests, assert, {});
    });

    test('a doc still over the target after its leaves spill sends whole lists', async function (assert) {
      await runSharedTest(searchDocSpillTests, assert, {});
    });
  });
});
