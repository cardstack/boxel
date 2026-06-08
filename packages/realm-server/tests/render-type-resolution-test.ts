import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import renderTypeResolutionTests from '@cardstack/runtime-common/tests/render-type-resolution-test';

module(basename(__filename), function () {
  module('render-type resolution', function () {
    test('an explicit renderType CodeRef wins', async function (assert) {
      await runSharedTest(renderTypeResolutionTests, assert, {});
    });

    test('"native" resolves to the most-derived type (types[0])', async function (assert) {
      await runSharedTest(renderTypeResolutionTests, assert, {});
    });

    test('an omitted renderType resolves to filter.on', async function (assert) {
      await runSharedTest(renderTypeResolutionTests, assert, {});
    });

    test('an omitted renderType with no filter.on falls back to the most-derived type', async function (assert) {
      await runSharedTest(renderTypeResolutionTests, assert, {});
    });

    test('the rule is not applied for dataOnly (the request carries no render)', async function (assert) {
      await runSharedTest(renderTypeResolutionTests, assert, {});
    });
  });
});
