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

  test('drops the anchor from a relevance sort', function (assert) {
    let query = {
      filter: { on: listing, matches: 'recipe' },
      sort: [{ by: '_matchRelevance', on: listing, direction: 'desc' }],
    } as unknown as Query;
    assert.deepEqual(pruneEmptyQueryParts(query).sort, [
      { by: '_matchRelevance', direction: 'desc' },
    ]);
  });

  test('drops a relevance sort when no search terms are left', function (assert) {
    let query = {
      filter: { type: listing, matches: '' },
      sort: [{ by: '_matchRelevance', direction: 'desc' }],
    } as unknown as Query;
    assert.deepEqual(pruneEmptyQueryParts(query), {
      filter: { type: listing },
    });
  });

  test('keeps the newer spelling signal sorts, which have no field `by`', function (assert) {
    let blend = {
      blend: [{ by: 'textRelevance' }, { by: 'createdAt', weight: 0.2 }],
    };
    let expression = { expression: 'item.price * 2', direction: 'desc' };
    let relevance = { relevance: true, on: listing };
    let boost = { boost: { eq: { featured: true } }, weight: 2 };
    let query = {
      type: listing,
      filter: { matches: 'recipe' },
      sort: [blend, expression, relevance, boost, { by: '' }],
    } as unknown as Query;
    assert.deepEqual(
      pruneEmptyQueryParts(query).sort as unknown,
      [blend, expression, relevance, boost],
      'each signal sort is kept as written; the empty field sort is dropped',
    );
  });

  test('keeps a top-level type and drops an empty one', function (assert) {
    let typed = {
      type: listing,
      filter: { missing: 'cardTitle' },
    } as unknown as Query;
    assert.deepEqual(pruneEmptyQueryParts(typed) as unknown, {
      type: listing,
      filter: { missing: 'cardTitle' },
    });

    let empty = {
      type: { module: '', name: '' },
      filter: { on: listing, eq: { name: 'Pasta' } },
    } as unknown as Query;
    assert.deepEqual(pruneEmptyQueryParts(empty) as unknown, {
      filter: { on: listing, eq: { name: 'Pasta' } },
    });
  });
});
