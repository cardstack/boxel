import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import coerceErrorMessageTests from '@cardstack/runtime-common/tests/coerce-error-message-test';

module(basename(__filename), function () {
  module('coerceErrorMessage', function () {
    test('returns the existing non-empty message', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });

    test('falls back to title when message is missing', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });

    test('falls back to title when message is empty string', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });

    test('falls back to first stack line when message and title are missing', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });

    test('returns the placeholder for an empty object', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });

    test('returns the placeholder for undefined', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });

    test('returns the placeholder for null', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });

    test('coerces a non-empty string thrown value', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });

    test('ignores whitespace-only message in favor of title', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });

    test('preserves the message on a real CardError', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });

    test('guarantees non-empty for the CS-11185 production shape', async function (assert) {
      await runSharedTest(coerceErrorMessageTests, assert, {});
    });
  });
});
