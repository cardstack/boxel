import { module, test } from 'qunit';
import { basename } from 'path';
import {
  parseUnifiedSearchRequestFromPayload,
  resolveRenderType,
  rri,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

const realmURL = 'http://localhost:4201/test/';

const baseRef: ResolvedCodeRef = {
  module: rri(`${realmURL}person`),
  name: 'Person',
};
const subRef: ResolvedCodeRef = {
  module: rri(`${realmURL}employee`),
  name: 'Employee',
};
const explicitRef: ResolvedCodeRef = {
  module: rri(`${realmURL}contact`),
  name: 'Contact',
};

module(basename(__filename), function () {
  module('render-type resolution', function () {
    test('an explicit renderType CodeRef wins', function (assert) {
      assert.deepEqual(
        resolveRenderType({
          renderType: explicitRef,
          filterOn: baseRef,
          types: [subRef, baseRef],
        }),
        explicitRef,
        'the explicit CodeRef is used regardless of filterOn / types',
      );
    });

    test('"native" resolves to the most-derived type (types[0])', function (assert) {
      assert.deepEqual(
        resolveRenderType({
          renderType: 'native',
          filterOn: baseRef,
          types: [subRef, baseRef],
        }),
        subRef,
        'native renders each result in its own actual type',
      );
    });

    test('an omitted renderType resolves to filter.on', function (assert) {
      assert.deepEqual(
        resolveRenderType({
          filterOn: baseRef,
          types: [subRef, baseRef],
        }),
        baseRef,
        'the default is the common ancestor searched on',
      );
    });

    test('an omitted renderType with no filter.on falls back to the most-derived type', function (assert) {
      assert.deepEqual(
        resolveRenderType({ types: [subRef, baseRef] }),
        subRef,
        'with no filter.on, render as the actual type',
      );
      assert.strictEqual(
        resolveRenderType({}),
        undefined,
        'with nothing to resolve from, returns undefined',
      );
    });

    test('the rule is not applied for dataOnly (the request carries no render)', function (assert) {
      // dataOnly is live-only — nothing is rendered, so there is no render spec
      // to feed the resolver. The parser enforces this by omitting `render`.
      let { render, dataOnly } = parseUnifiedSearchRequestFromPayload({
        realms: [realmURL],
        dataOnly: true,
      });
      assert.true(dataOnly, 'dataOnly is honored');
      assert.strictEqual(
        render,
        undefined,
        'no render spec exists for a dataOnly request, so the rule is inapplicable',
      );
    });
  });
});
