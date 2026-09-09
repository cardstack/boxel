import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import operationLoweringExecutableTests from '@cardstack/runtime-common/tests/operation-lowering-executable-test';

module(basename(import.meta.filename), function () {
  module('operation lowering is executable', function () {
    test('every program lowering emits can be planned by the executor', async function (assert) {
      await runSharedTest(operationLoweringExecutableTests, assert, {});
    });

    test('every declaration lowering refuses is one the executor would reject', async function (assert) {
      await runSharedTest(operationLoweringExecutableTests, assert, {});
    });

    test('naming a link identity explicitly lowers the same as naming it bare', async function (assert) {
      await runSharedTest(operationLoweringExecutableTests, assert, {});
    });

    test('an assert over a link collection fires on a duplicate and not otherwise', async function (assert) {
      await runSharedTest(operationLoweringExecutableTests, assert, {});
    });
  });
});
