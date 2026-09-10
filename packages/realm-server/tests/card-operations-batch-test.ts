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

    test('a removal takes a card, not any stored json', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a write into the capture subtree is refused', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a base version is compared to the bytes the merge is computed over', async function (assert) {
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

    test('two entries changing one card compose, and the file is written once', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a base version names what the entry merged over, not the batch pre-state', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a removal after a change takes the card, and the write with it', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a change after a removal has nothing to change', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a card the batch creates is not a target for a later entry', async function (assert) {
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

    test('every read and the commit happen inside one holding of the write lock', async function (assert) {
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

    test('a local id inside a data array is refused rather than dropped', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a member written under its own key still links', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('bytes the realm will not store are refused before anything commits', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('an empty batch touches nothing at all', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a batch drains in-flight indexing before it serializes anything', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('an update rewrites a side-loaded card that is already stored', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a template that reads the actor needs one', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('an update carries the patch to apply', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a patch merges relationship keys rather than replacing the map', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a replaced array drops the field metadata of the members it removed', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });

    test('a create with nothing to create is refused', async function (assert) {
      await runSharedTest(cardOperationsBatchTests, assert, {});
    });
  });
});
