import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import cardOperationsDispatchTests from '@cardstack/runtime-common/tests/card-operations-dispatch-test';

module(basename(import.meta.filename), function () {
  module('card operations dispatch', function () {
    test('a base operation with no declaration resolves to its built-in behavior', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a declaration wins over the built-in of the same name', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a name that is neither declared nor a base operation is refused', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a def type that does not carry the behavior refuses it', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a declaration lowering flagged invalid reports its findings', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a read serves the indexed document with its generation joined on', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a headers-only read shares dispatch read of the index row', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('an errored index row carries its own status through', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a read tells a missing card from one still being indexed', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a target outside the realm is refused before anything is read', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a type nobody can resolve is refused as a missing target', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a card whose type entry is unreadable still reads', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('the row peek is memoized for one invocation and no longer', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });
  });
});
