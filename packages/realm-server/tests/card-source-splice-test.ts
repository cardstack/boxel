import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import cardSourceSpliceTests from '@cardstack/runtime-common/tests/card-source-splice-test';

module(basename(import.meta.filename), function () {
  module('card source splice', function () {
    test('a document is read the same whatever the bytes arrive in', async function (assert) {
      await runSharedTest(cardSourceSpliceTests, assert, {});
    });

    test("an append reuses the file's own indentation", async function (assert) {
      await runSharedTest(cardSourceSpliceTests, assert, {});
    });

    test('a value whose bytes are not its characters is spliced at the right offset', async function (assert) {
      await runSharedTest(cardSourceSpliceTests, assert, {});
    });

    test('an array the file does not carry is created', async function (assert) {
      await runSharedTest(cardSourceSpliceTests, assert, {});
    });

    test('attributes the file does not carry are created', async function (assert) {
      await runSharedTest(cardSourceSpliceTests, assert, {});
    });

    test('a document that ends part-way through is refused', async function (assert) {
      await runSharedTest(cardSourceSpliceTests, assert, {});
    });

    test('a brace inside a string is not a container', async function (assert) {
      await runSharedTest(cardSourceSpliceTests, assert, {});
    });

    test('an escaped quote does not end the string it is in', async function (assert) {
      await runSharedTest(cardSourceSpliceTests, assert, {});
    });

    test('a description splices into a description', async function (assert) {
      await runSharedTest(cardSourceSpliceTests, assert, {});
    });

    test('appending to a hundred thousand items costs one item', async function (assert) {
      await runSharedTest(cardSourceSpliceTests, assert, {});
    });
  });
});
