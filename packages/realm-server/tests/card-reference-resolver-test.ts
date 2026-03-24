import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import cardReferenceResolverTests from '@cardstack/runtime-common/tests/card-reference-resolver-test';

module(basename(__filename), function () {
  module('resolveCardReference', function () {
    test('resolves a prefix-mapped reference', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('resolves a prefix-mapped reference with nested path', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('resolves a relative URL with a normal URL base', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('resolves an absolute https:// URL when relativeTo is a prefix-form ID', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('resolves an absolute http:// URL when relativeTo is a prefix-form ID', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('resolves an absolute URL when relativeTo is undefined', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('resolves a relative URL when relativeTo is a prefix-form ID', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('resolves a relative URL when relativeTo is a different prefix-form ID', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('throws for an unregistered bare specifier', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });

    test('resolves a root-relative URL with a normal URL base', async function (assert) {
      await runSharedTest(cardReferenceResolverTests, assert, {});
    });
  });
});
