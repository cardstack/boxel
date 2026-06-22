import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import runCommandTaskTests from '@cardstack/runtime-common/tests/run-command-task-shared-tests';

module(basename(import.meta.filename), function () {
  module('run-command task', function () {
    test('returns error when runAs has no realm permissions', async function (assert) {
      await runSharedTest(runCommandTaskTests, assert, {});
    });

    test('returns error when command specifier is invalid', async function (assert) {
      await runSharedTest(runCommandTaskTests, assert, {});
    });

    test('normalizes legacy /commands URL and defaults export name', async function (assert) {
      await runSharedTest(runCommandTaskTests, assert, {});
    });

    test('passes scoped command through unchanged', async function (assert) {
      await runSharedTest(runCommandTaskTests, assert, {});
    });
  });
});
