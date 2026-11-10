import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { assertQuery, type Query } from '@cardstack/runtime-common';
import {
  applySearchPageBound,
  applyServerSearchPageBound,
  MAX_SEARCH_PAGE_SIZE,
  SERVER_MAX_SEARCH_PAGE_SIZE,
} from '@cardstack/runtime-common/search-bounds';
import { usesNewSyntax } from '@cardstack/runtime-common/query-syntax';
import { internalSortKeyIn } from '@cardstack/runtime-common/internal-sort-keys';

// Queries saved in realms were written against the grammar as it stood before
// the newer spellings (a top-level `type`, `blend`, `expression`, facets and
// the rest). Each one here was accepted then, so it is accepted now, read the
// same way, with no rewrite. A query is added to this table when a spelling
// is found in a realm; none is ever removed.

const on = { module: 'http://test-realm/person', name: 'Person' };

const accepted: [string, Record<string, any>][] = [
  ['every card of a type', { filter: { type: on } }],
  ['eq', { filter: { on, eq: { name: 'a' } } }],
  ['eq on a missing value', { filter: { on, eq: { name: null } } }],
  ['eq on two fields', { filter: { on, eq: { 'address.city': 'x', age: 3 } } }],
  ['eq with no anchor', { filter: { eq: { name: 'a' } } }],
  ['eq with no fields', { filter: { on, eq: {} } }],
  ['contains', { filter: { on, contains: { name: 'a' } } }],
  ['contains null', { filter: { on, contains: { name: null } } }],
  ['in', { filter: { on, in: { name: ['a', 'b'] } } }],
  ['in an empty list', { filter: { on, in: { name: [] } } }],
  ['range', { filter: { on, range: { age: { gt: 1, lte: 5 } } } }],
  ['a date range', { filter: { on, range: { age: { gte: '2020-01-01' } } } }],
  ['matches', { filter: { on, matches: 'hello world' } }],
  ['matches with no anchor', { filter: { matches: 'hello' } }],
  ['not', { filter: { on, not: { eq: { name: 'a' } } } }],
  ['not, anchored inside', { filter: { not: { on, eq: { name: 'a' } } } }],
  [
    'any',
    {
      filter: {
        on,
        any: [{ eq: { name: 'a' } }, { on, contains: { name: 'b' } }],
      },
    },
  ],
  ['every', { filter: { every: [{ type: on }, { on, eq: { name: 'a' } }] } }],
  ['an empty every', { filter: { on, every: [] } }],
  ['an empty any', { filter: { any: [] } }],
  ['no filter at all', {}],
  ['a general sort', { sort: [{ by: 'lastModified' }] }],
  [
    'createdAt, newest first',
    { sort: [{ by: 'createdAt', direction: 'desc' }] },
  ],
  ['cardURL', { sort: [{ by: 'cardURL', direction: 'asc' }] }],
  [
    'a field sort then a general one',
    { sort: [{ on, by: 'name', direction: 'desc' }, { by: 'lastModified' }] },
  ],
  ['a nested field sort', { sort: [{ on, by: 'address.city' }] }],
  [
    'text relevance under its first name',
    { filter: { on, matches: 'hello' }, sort: [{ by: '_matchRelevance' }] },
  ],
  [
    'text relevance, then a field',
    {
      filter: { on, matches: 'hello' },
      sort: [
        { by: '_matchRelevance', direction: 'desc' },
        { on, by: 'name' },
      ],
    },
  ],
  ['a page size', { filter: { type: on }, page: { size: 10 } }],
  ['a page size as text', { filter: { type: on }, page: { size: '10' } }],
  ['a page number', { filter: { type: on }, page: { number: 2, size: 10 } }],
  ['an empty page', { filter: { type: on }, page: {} }],
  [
    'a page cursor',
    { filter: { type: on }, page: { size: 10, cursor: 'abc' } },
  ],
  [
    'a page member the grammar never read',
    { filter: { type: on }, page: { size: 10, realmVersion: 3 } },
  ],
  ['a negative page size', { filter: { type: on }, page: { size: -1 } }],
  [
    'a filter member the grammar never read',
    { filter: { on, eq: { name: 'a' }, note: 'mine' } },
  ],
  [
    'a sort member the grammar never read',
    { filter: { type: on }, sort: [{ on, by: 'name', note: 'mine' }] },
  ],
];

module(basename(import.meta.filename), function () {
  for (let [name, query] of accepted) {
    test(`accepted as written: ${name}`, function (assert) {
      assert.false(usesNewSyntax(query), 'it is in the older spelling');
      let before = JSON.stringify(query);
      assertQuery(query);
      assert.strictEqual(
        JSON.stringify(query),
        before,
        'and is left as written',
      );
    });
  }

  test('_matchRelevance is a sort an author may write; the engine-only keys are not', function (assert) {
    for (let by of ['_matchRelevance', 'item._matchRelevance']) {
      assert.strictEqual(internalSortKeyIn([{ by }]), undefined, by);
    }
    for (let by of ['_blend', '_expr', '_when', '_relevance']) {
      assert.strictEqual(internalSortKeyIn([{ by }])?.by, by, by);
    }
    assert.strictEqual(
      internalSortKeyIn([{ by: '_blend', of: [{ by: '_matchRelevance' }] }])
        ?.by,
      '_blend',
    );
  });

  test('a newer spelling is still checked strictly', function (assert) {
    assert.throws(
      () => assertQuery({ type: on, filter: { eq: { name: 'a' }, note: 'x' } }),
      /unknown member "note"/,
    );
    assert.throws(
      () => assertQuery({ type: on, page: { size: 10, cursor: 'abc' } }),
      /unknown member "cursor"/,
    );
  });

  test('a query naming no page gets the page it always got', function (assert) {
    let query = { filter: { type: on } } as Query;
    assert.strictEqual(MAX_SEARCH_PAGE_SIZE, 100);
    assert.strictEqual(SERVER_MAX_SEARCH_PAGE_SIZE, 500);
    assert.deepEqual(applySearchPageBound(query).page, { size: 100 });
    assert.deepEqual(applyServerSearchPageBound(query).page, { size: 500 });
  });

  test('a negative page size is clamped, not refused', function (assert) {
    let query = { filter: { type: on }, page: { size: -1 } } as Query;
    assert.strictEqual(applySearchPageBound(query).page?.size, 100);
    assert.strictEqual(applyServerSearchPageBound(query).page?.size, 500);
  });
});
