import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import bfmCardReferencesTests from '@cardstack/runtime-common/tests/bfm-card-references-test';

module(basename(import.meta.filename), function () {
  module('cardTypeName', function () {
    test('cardTypeName extracts type from absolute URL', async function (assert) {
      await runSharedTest(bfmCardReferencesTests, assert, {});
    });

    test('cardTypeName extracts type from relative path', async function (assert) {
      await runSharedTest(bfmCardReferencesTests, assert, {});
    });

    test('cardTypeName strips .json extension before extracting', async function (assert) {
      await runSharedTest(bfmCardReferencesTests, assert, {});
    });

    test('cardTypeName strips trailing slash', async function (assert) {
      await runSharedTest(bfmCardReferencesTests, assert, {});
    });

    test('cardTypeName returns single segment as type name', async function (assert) {
      await runSharedTest(bfmCardReferencesTests, assert, {});
    });

    test('cardTypeName returns Card for empty string', async function (assert) {
      await runSharedTest(bfmCardReferencesTests, assert, {});
    });

    test('cardTypeName handles deeply nested URLs', async function (assert) {
      await runSharedTest(bfmCardReferencesTests, assert, {});
    });
  });
});
