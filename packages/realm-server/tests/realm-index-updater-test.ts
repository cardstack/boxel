import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import realmIndexUpdaterTests from '@cardstack/runtime-common/tests/realm-index-updater-test';

module(basename(import.meta.filename), function () {
  for (let name of Object.keys(realmIndexUpdaterTests)) {
    test(name, async function (assert) {
      await runSharedTest(realmIndexUpdaterTests, assert, {});
    });
  }
});
