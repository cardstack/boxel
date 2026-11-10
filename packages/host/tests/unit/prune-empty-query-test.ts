import { module, test } from 'qunit';

import {
  assertQuery,
  InvalidQueryError,
  type CodeRef,
  type Query,
} from '@cardstack/runtime-common';

import { pruneEmptyQueryParts } from '@cardstack/host/utils/search/prune-empty-query';

const listingModule = '@cardstack/catalog/catalog-app/listing/listing';
const listing = {
  module: listingModule,
  name: 'Listing',
} as unknown as CodeRef;
const spec = {
  module: '@cardstack/base/spec',
  name: 'Spec',
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

  test('keeps a part of the wrong shape for validation to refuse', function (assert) {
    // Not left unfilled: dropping one of these would widen the search, often
    // to everything, without an error.
    let cases: [unknown, unknown][] = [
      ['invoice', 'invoice'],
      [
        { every: { eq: { title: 'Invoice' } } },
        { every: { eq: { title: 'Invoice' } } },
      ],
      [{ any: ['invoice', 'bill'] }, { any: ['invoice', 'bill'] }],
      [{ type: 'Invoice' }, { type: 'Invoice' }],
      [{ on: 'Spec' }, { on: 'Spec' }],
      [
        { type: { module: listingModule, name: '' } },
        { type: { module: listingModule, name: '' } },
      ],
      [
        { on: listing, matches: ['invoice', 'bill'] },
        { on: listing, matches: ['invoice', 'bill'] },
      ],
      [
        { every: [{ on: listing }, 'invoice'] },
        { every: [{ type: listing }, 'invoice'] },
      ],
      [
        { on: 'Spec', matches: 'invoice' },
        { on: 'Spec', matches: 'invoice' },
      ],
      [
        { on: listing, matches: 'invoice', not: 'draft' },
        { on: listing, matches: 'invoice', not: 'draft' },
      ],
      [{ not: 'draft' }, { not: 'draft' }],
      [
        { type: listing, on: spec },
        { type: listing, on: spec },
      ],
    ];
    for (let [filter, expected] of cases) {
      let pruned = pruneEmptyQueryParts({ filter } as unknown as Query);
      assert.deepEqual(
        pruned.filter,
        expected as Query['filter'],
        `kept ${JSON.stringify(filter)}`,
      );
      assert.throws(
        () => assertQuery(pruned),
        InvalidQueryError,
        `validation refuses ${JSON.stringify(filter)}`,
      );
    }

    // Not left unfilled: dropping one of these would return the results
    // unsorted, or sorted without the card type the model named.
    for (let sort of [
      ['lastModified'],
      [{ by: ['cardTitle'] }],
      [{ by: 'cardTitle', on: 'Spec' }],
      [{ by: 'cardTitle', on: listing }, 'lastModified'],
      { by: 'cardTitle' },
    ]) {
      let pruned = pruneEmptyQueryParts({ sort } as unknown as Query);
      assert.deepEqual(
        pruned.sort,
        sort as unknown as Query['sort'],
        `kept sort ${JSON.stringify(sort)}`,
      );
      assert.throws(
        () => assertQuery(pruned),
        InvalidQueryError,
        `validation refuses sort ${JSON.stringify(sort)}`,
      );
    }
  });

  test('still drops a part with nothing in it', function (assert) {
    assert.deepEqual(
      pruneEmptyQueryParts({
        filter: {
          matches: ['', ' '],
          every: '',
          not: '',
          type: { module: '', name: '' },
          on: { module: ' ' },
        },
        sort: [{ by: 'cardTitle', on: '' }],
      } as unknown as Query),
      { sort: [{ by: 'cardTitle' }] } as unknown as Query,
    );
    assert.deepEqual(
      pruneEmptyQueryParts({
        filter: { on: listing, type: null, matches: '' },
      } as unknown as Query),
      { filter: { type: listing } } as unknown as Query,
      'a filter left with a blank type beside its card type is a type filter',
    );
    assert.deepEqual(
      pruneEmptyQueryParts({
        filter: { on: listing, eq: [], contains: [], in: [''], range: null },
      } as unknown as Query),
      { filter: { type: listing } } as unknown as Query,
      'an operator with an empty list is dropped like an empty object',
    );
    assert.deepEqual(
      pruneEmptyQueryParts({
        sort: [{ by: '', direction: 'asc' }, { direction: 'desc' }, {}, ''],
      } as unknown as Query),
      {},
      'a sort entry that names no field is dropped',
    );
    for (let blank of [null, '', {}]) {
      assert.deepEqual(
        pruneEmptyQueryParts({ sort: blank, page: blank } as unknown as Query),
        {},
        `an empty sort and page (${JSON.stringify(blank)}) are dropped`,
      );
    }
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
});
