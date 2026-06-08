import type { SharedTests } from '../helpers';
import { rri } from '../realm-identifiers';
import type { ResolvedCodeRef } from '../code-ref';
import {
  parseUnifiedSearchRequestFromPayload,
  resolveRenderType,
} from '../search-utils';

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

const tests = Object.freeze({
  'an explicit renderType CodeRef wins': async (assert) => {
    assert.deepEqual(
      resolveRenderType({
        renderType: explicitRef,
        filterOn: baseRef,
        types: [subRef, baseRef],
      }),
      explicitRef,
      'the explicit CodeRef is used regardless of filterOn / types',
    );
  },

  '"native" resolves to the most-derived type (types[0])': async (assert) => {
    assert.deepEqual(
      resolveRenderType({
        renderType: 'native',
        filterOn: baseRef,
        types: [subRef, baseRef],
      }),
      subRef,
      'native renders each result in its own actual type',
    );
  },

  'an omitted renderType resolves to filter.on': async (assert) => {
    assert.deepEqual(
      resolveRenderType({
        filterOn: baseRef,
        types: [subRef, baseRef],
      }),
      baseRef,
      'the default is the common ancestor searched on',
    );
  },

  'an omitted renderType with no filter.on falls back to the most-derived type':
    async (assert) => {
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
    },

  'the rule is not applied for dataOnly (the request carries no render)':
    async (assert) => {
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
    },
} as SharedTests<{}>);

export default tests;
