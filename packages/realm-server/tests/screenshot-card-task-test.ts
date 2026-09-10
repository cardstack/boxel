import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import screenshotCardTaskTests from '@cardstack/runtime-common/tests/screenshot-card-task-shared-tests';

module(basename(import.meta.filename), function () {
  module('screenshot-card task', function () {
    test('mints the union of the wildcard grant and the runner row', async function (assert) {
      await runSharedTest(screenshotCardTaskTests, assert, {});
    });

    test('mints the union of the users grant for a registered matrix user', async function (assert) {
      await runSharedTest(screenshotCardTaskTests, assert, {});
    });

    test('captures for a runner whose only access is the wildcard grant', async function (assert) {
      await runSharedTest(screenshotCardTaskTests, assert, {});
    });

    test('refuses a runner with no access to the realm', async function (assert) {
      await runSharedTest(screenshotCardTaskTests, assert, {});
    });
  });
});
