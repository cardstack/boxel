import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import decklistResolutionTests from '@cardstack/runtime-common/tests/decklist-resolution-test';

module(basename(import.meta.filename), function () {
  module('decklist resolution', function () {
    test('two majors of one library coexist, chosen by importer', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });

    test('the scope applies to the whole subtree beneath it', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });

    test('a sibling whose name merely starts with the scope is NOT governed', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });

    test('with no decklist, resolution is byte-identical to the handler chain', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });

    test('an importer-less caller still resolves the realm-wide import', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });
  });
});
