import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import assertQueryValidationTests from '@cardstack/runtime-common/tests/assert-query-validation-test';

module(basename(import.meta.filename), function () {
  module('assertQuery collection validation', function () {
    test('assertQuery validates every element of an any filter', async function (assert) {
      await runSharedTest(assertQueryValidationTests, assert, {});
    });

    test('assertQuery validates every field path of a range filter', async function (assert) {
      await runSharedTest(assertQueryValidationTests, assert, {});
    });

    test('assertQuery validates every constraint of a range field', async function (assert) {
      await runSharedTest(assertQueryValidationTests, assert, {});
    });

    test('assertQuery validates every entry of a nested JSON value', async function (assert) {
      await runSharedTest(assertQueryValidationTests, assert, {});
    });

    test('assertQuery validates every element of a nested JSON array', async function (assert) {
      await runSharedTest(assertQueryValidationTests, assert, {});
    });

    test('assertQuery accepts the multi-entry shapes the grammar allows', async function (assert) {
      await runSharedTest(assertQueryValidationTests, assert, {});
    });
  });
});
