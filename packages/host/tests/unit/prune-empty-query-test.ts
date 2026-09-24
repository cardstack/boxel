import { module, test } from 'qunit';

import type { CodeRef, Query } from '@cardstack/runtime-common';

import { pruneEmptyQueryParts } from '@cardstack/host/utils/search/prune-empty-query';

const listing = {
  module: '@cardstack/catalog/catalog-app/listing/listing',
  name: 'Listing',
} as unknown as CodeRef;

module('Unit | prune-empty-query', function () {
  test('drops the empty parts a model fills in for every schema property', function (assert) {
    let query = {
      page: { size: 10, number: 0 },
      sort: [],
      filter: {
        eq: {},
        on: listing,
        any: [],
        not: {},
        type: { name: '', module: '' },
        every: [],
        range: {},
        contains: {},
        in: {},
        matches: 'recipe cookbook',
      },
    } as unknown as Query;

    assert.deepEqual(pruneEmptyQueryParts(query), {
      page: { size: 10, number: 0 },
      filter: { on: listing, matches: 'recipe cookbook' },
    });
  });

  test('a filter left with only a card type becomes a type filter', function (assert) {
    let onOnly = {
      filter: { on: listing, eq: {}, type: { name: '', module: '' } },
    } as unknown as Query;
    assert.deepEqual(pruneEmptyQueryParts(onOnly), {
      filter: { type: listing },
    });

    let onAndType = {
      filter: { on: listing, type: listing, matches: '' },
    } as unknown as Query;
    assert.deepEqual(pruneEmptyQueryParts(onAndType), {
      filter: { type: listing },
    });
  });

  test('prunes nested filters and leaves real conditions alone', function (assert) {
    let query = {
      filter: {
        every: [
          { on: listing, matches: 'recipe', eq: {} },
          { any: [], not: {} },
          { eq: { name: 'Pasta' }, on: listing },
        ],
      },
      sort: [{ by: 'cardTitle', on: { module: '', name: '' } }],
    } as unknown as Query;

    assert.deepEqual(pruneEmptyQueryParts(query), {
      filter: {
        every: [
          { on: listing, matches: 'recipe' },
          { eq: { name: 'Pasta' }, on: listing },
        ],
      },
      sort: [{ by: 'cardTitle' }],
    });
  });
});
