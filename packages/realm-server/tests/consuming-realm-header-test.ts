import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import consumingRealmHeaderTests from '@cardstack/runtime-common/tests/consuming-realm-header-test';

module(basename(__filename), function () {
  module('sanitizeConsumingRealmHeader', function () {
    test('accepts a plain http realm URL', async function (assert) {
      await runSharedTest(consumingRealmHeaderTests, assert, {});
    });

    test('accepts a plain https realm URL', async function (assert) {
      await runSharedTest(consumingRealmHeaderTests, assert, {});
    });

    test('trims surrounding whitespace', async function (assert) {
      await runSharedTest(consumingRealmHeaderTests, assert, {});
    });

    test('rejects non-http(s) schemes', async function (assert) {
      await runSharedTest(consumingRealmHeaderTests, assert, {});
    });

    test('rejects empty / whitespace-only / null values', async function (assert) {
      await runSharedTest(consumingRealmHeaderTests, assert, {});
    });

    test('rejects values containing control characters', async function (assert) {
      await runSharedTest(consumingRealmHeaderTests, assert, {});
    });

    test('rejects pathologically long values', async function (assert) {
      await runSharedTest(consumingRealmHeaderTests, assert, {});
    });

    test('rejects non-string inputs', async function (assert) {
      await runSharedTest(consumingRealmHeaderTests, assert, {});
    });
  });
});
