import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import importMapInvalidationTests from '@cardstack/runtime-common/tests/import-map-invalidation-test';

module(basename(import.meta.filename), function () {
  module('an import-map change is a code change', function () {
    test('the id the index actually emits is recognised', async function (assert) {
      await runSharedTest(importMapInvalidationTests, assert, {});
    });

    test('a package manifest is not the realm map', async function (assert) {
      await runSharedTest(importMapInvalidationTests, assert, {});
    });

    test('another realm’s map is not this realm’s', async function (assert) {
      await runSharedTest(importMapInvalidationTests, assert, {});
    });

    test('it finds the map among unrelated invalidations', async function (assert) {
      await runSharedTest(importMapInvalidationTests, assert, {});
    });
  });
});
