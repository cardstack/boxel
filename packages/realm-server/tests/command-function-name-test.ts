import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import commandFunctionNameTests from '@cardstack/runtime-common/tests/command-function-name-test';

module(basename(import.meta.filename), function () {
  module('command function name hashing', function () {
    test('a host tool ref hashes to the same functionName under either module spelling', async function (assert) {
      await runSharedTest(commandFunctionNameTests, assert, {});
    });

    test('named exports also produce identical functionNames across spellings', async function (assert) {
      await runSharedTest(commandFunctionNameTests, assert, {});
    });

    test('non-host modules hash verbatim', async function (assert) {
      await runSharedTest(commandFunctionNameTests, assert, {});
    });

    test('a tools path that merely contains the prefix mid-string is not mapped', async function (assert) {
      await runSharedTest(commandFunctionNameTests, assert, {});
    });
  });
});
