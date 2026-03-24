import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import cardReferenceResolverTests from '@cardstack/runtime-common/tests/card-reference-resolver-test';

module(basename(__filename), function () {
  module('card reference resolver', function () {
    test('resolveCardReference resolves relative URL against prefix-form ID via cardIdToURL', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('cardIdToURL works for both prefix-form and regular URL IDs', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });
  });
});
