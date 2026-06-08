import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import unifiedSearchContractsTests from '@cardstack/runtime-common/tests/unified-search-contracts-test';

module(basename(__filename), function () {
  module('unified search contracts', function () {
    test('isIdentityOnlyCardResource keys on meta.identityOnly, not attribute-absence', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('isRenderedHtmlResource recognizes a rendered-html resource', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('isCssResource recognizes a css resource', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('parse: render.format is used when provided', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('parse: render.format defaults to fitted when omitted', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('parse: render.renderType accepts a CodeRef', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('parse: render.renderType accepts the "native" escape valve', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('parse: render.renderType omitted leaves renderType unset', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('parse: invalid renderType is rejected', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('parse: a non-object body is rejected', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('parse: dataOnly true yields live-only with no render', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('parse: a body with no render is not data-only', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('parse: cardUrls round-trips', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });

    test('cssResourceId is stable and dedupes identical CSS', async function (assert) {
      await runSharedTest(unifiedSearchContractsTests, assert, {});
    });
  });
});
