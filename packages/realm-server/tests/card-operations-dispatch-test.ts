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

    test('a type nobody can resolve is refused as a missing target', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a card whose type entry is unreadable still reads', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a target is canonicalized before anything is read', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a declared read the executor cannot carry out is refused', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a payload missing a declared param is refused before any behavior runs', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a name every object answers to is unknown, not a dispatchable operation', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a headers-only read of a file answers from the file row', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a read needs an instance to read', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a declared operation resolves the same however the target is spelled', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a card source spelling names the source, not the card', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a file def declaration is resolved the same as a card def one', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a foreign target is refused without reading the index', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('both read modes answer for a file whose extension is not registered', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a malformed type realm is a refusal, not a raw throw', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a read refuses any clause it does not carry out', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a stored-bytes read serves the bytes and infers their content type', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a stored-bytes read consults neither a definition nor the index', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('the headers-only mode reports the metadata without touching the bytes', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a stored-bytes read reports a version the realm never recorded as absent', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a path with no stored bytes is not found, never not-indexed', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a type has no stored bytes to read', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('a declaration may not build on a stored-bytes read', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });

    test('the row peek is memoized for one invocation and no longer', async function (assert) {
      await runSharedTest(cardOperationsDispatchTests, assert, {});
    });
  });
});
