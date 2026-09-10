import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import cardOperationsBatchTests from '@cardstack/runtime-common/tests/card-operations-batch-test';

module(basename(import.meta.filename), function () {
  module('card operations batch', function () {
    test('a create is staged at the path its local id names', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a later entry links to a card an earlier one mints', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a side-loaded resource is created alongside its primary', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('an entry that cannot be staged abandons the batch before it commits', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a patch merges over the stored file, replacing arrays', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a patch that changes nothing stages the bytes already on disk', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a patch cannot change the type a card adopts', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('realm-managed keys in a patch never reach the file', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a write and a removal reach the commit together', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a removal needs something to remove', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a base version is reported against the fingerprint the file carried', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('an unconditional write reports no base match', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a base version belongs only to an update', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a local id names one card', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a link to a local id nothing creates is refused', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('two entries changing one card are refused rather than ordered', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a target outside the realm is not the batch to commit it', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a create naming another realm is refused', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a field the type refuses is the payload to fix, not the realm', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a stored file that is not a card document is the realm to answer for', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('the write lock is taken once for the whole batch', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a named create stages the type and attributes its declaration names', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a named create resolves the actor and the card it is anchored on', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a named create with no target in scope cannot read one', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a named create links to a card the same batch mints', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a local id cannot name a file outside the type it creates', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a create does not commit over a card already stored at its destination', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a create names its card by the local id on the resource', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a malformed side-load is refused rather than reaching the serializer', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('staging leaves the document it was handed alone', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a named create needs every value its declaration asks for', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a create with nothing to create is refused', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });
  });
});
