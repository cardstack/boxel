import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import passageIndexTests from '@cardstack/runtime-common/tests/passage-index-test';

module(basename(import.meta.filename), function () {
  module('passage index', function () {
    test('collects the items of the fields _passages names, by position', async function (assert) {
      await runSharedTest(passageIndexTests, assert, {});
    });

    test('a search doc without _passages has no passages', async function (assert) {
      await runSharedTest(passageIndexTests, assert, {});
    });
  });
});
