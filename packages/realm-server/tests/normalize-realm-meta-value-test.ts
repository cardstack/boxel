import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import normalizeRealmMetaValueTests from '@cardstack/runtime-common/tests/normalize-realm-meta-value-test';

module(basename(import.meta.filename), function () {
  module('normalizeRealmMetaValue', function () {
    test('undefined value normalizes to empty groups', async function (assert) {
      await runSharedTest(normalizeRealmMetaValueTests, assert, {});
    });

    test('null value normalizes to empty groups', async function (assert) {
      await runSharedTest(normalizeRealmMetaValueTests, assert, {});
    });

    test('legacy array shape maps to instances, files defaults to empty', async function (assert) {
      await runSharedTest(normalizeRealmMetaValueTests, assert, {});
    });

    test('partitioned shape passes through', async function (assert) {
      await runSharedTest(normalizeRealmMetaValueTests, assert, {});
    });

    test('missing arms default to empty arrays', async function (assert) {
      await runSharedTest(normalizeRealmMetaValueTests, assert, {});
    });

    test('unrecognized object shape normalizes to empty groups', async function (assert) {
      await runSharedTest(normalizeRealmMetaValueTests, assert, {});
    });
  });
});
