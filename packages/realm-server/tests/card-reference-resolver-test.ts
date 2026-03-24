import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import cardReferenceResolverTests from '@cardstack/runtime-common/tests/card-reference-resolver-test';

module(basename(__filename), function () {
  module('card reference resolver', function () {
    test('relativizeDocument succeeds when resource ID is a registered prefix', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('relativizeDocument succeeds when resource ID is a regular URL', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });
  });
});
