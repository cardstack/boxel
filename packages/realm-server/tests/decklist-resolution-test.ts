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

    test('a hand-written decklist uses relative paths and stays portable', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });

    test('two realms pin the same library differently, and neither wins', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });

    test("a realm's own scopes still beat its realm-wide default", async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });

    test('reloading a realm decklist replaces it, dropping retracted pins', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });

    test('addDecklist accumulates, which is exactly why realms do not use it', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });

    test('removing a realm decklist takes its pins with it', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });

    test('editing the decklist changes what resolves', async function (assert) {
      await runSharedTest(decklistResolutionTests, assert, {});
    });
  });
});
