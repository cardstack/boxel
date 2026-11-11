import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  assertQuery,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common/search-entry';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';
import {
  applySearchPageBound,
  applyServerSearchPageBound,
  MAX_SEARCH_PAGE_SIZE,
  SERVER_MAX_SEARCH_PAGE_SIZE,
} from '@cardstack/runtime-common/search-bounds';
import {
  assertAuthoredQuerySpelling,
  usesNewSyntax,
} from '@cardstack/runtime-common/query-syntax';
import { internalSortKeyIn } from '@cardstack/runtime-common/internal-sort-keys';

// Queries saved in realms were written against the grammar as it stood before
// the newer spellings (a top-level `type`, `blend`, `expression`, facets and
// the rest). Each one here was accepted then, so it is accepted now, read the
// same way, with no rewrite. A query is added to this table when a spelling
// is found in a realm; none is ever removed.

const on = {
  module: 'http://test-realm/person',
  name: 'Person',
} as ResolvedCodeRef;

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

  test('the wire translator lowers a newer spelling and leaves an older one as it was', function (assert) {
    // older: the translator's output is what it always was
    let older: Query = {
      filter: { on, eq: { name: 'a' } },
      sort: [{ on, by: 'age', direction: 'desc' }],
      page: { size: 5 },
    };
    assert.deepEqual(searchEntryWireQueryFromQuery(older), {
      filter: { 'item.on': on, eq: { 'item.name': 'a' } },
      sort: [{ by: 'item.age', 'item.on': on, direction: 'desc' }],
      page: { size: 5 },
    });
    // newer: a top-level type and `exists` reach the wire, lowered
    let newer = {
      type: on,
      filter: { exists: 'age' },
      sort: [{ by: 'age' }],
    } as unknown as Query;
    let wire = searchEntryWireQueryFromQuery(newer) as Record<string, any>;
    assert.deepEqual(
      wire,
      searchEntryWireQueryFromQuery(
        lowerQuery(newer as Record<string, any>).query as Query,
      ),
      'the same as wiring the lowered query (lowering twice is lowering once)',
    );
    assert.deepEqual(wire.filter['item.on'], on, 'the type anchors the filter');
    assert.deepEqual(
      parseSearchEntryQueryFromPayload(wire).itemQuery,
      parseSearchEntryQueryFromPayload(newer as Record<string, any>).itemQuery,
      'the server reads the wired query as it reads the newer spelling',
    );
    // `select` rides along
    let selecting = searchEntryWireQueryFromQuery({
      type: on,
      select: ['name', { years: 'age' }],
    } as unknown as Query);
    assert.deepEqual(selecting.select, ['name', { years: 'age' }]);
  });

  test('a limit holds the newer spelling; the older one is refused only where the database failed', function (assert) {
    let code = (query: unknown) => {
      try {
        assertQuery(query as Query);
        return 'accepted';
      } catch (e: any) {
        return e.code;
      }
    };
    let values = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    let sorts = (n: number) =>
      Array.from({ length: n }, () => ({ on, by: 'age' }));
    let nested = (depth: number) => {
      let node: Record<string, any> = { on, eq: { name: 'a' } };
      for (let i = 0; i < depth; i++) node = { on, every: [node] };
      return node;
    };
    // an `in` list
    assert.strictEqual(
      code({ type: on, filter: { in: { name: values(10_001) } } }),
      'limit-exceeded',
      'newer: 10,001 values',
    );
    assert.strictEqual(
      code({ filter: { on, in: { name: values(10_001) } } }),
      'accepted',
      'older: 10,001 values, as on main',
    );
    assert.strictEqual(
      code({ filter: { on, in: { name: values(65_001) } } }),
      'limit-exceeded',
      'older: 65,001 values, past what Postgres binds',
    );
    // sort entries
    assert.strictEqual(
      code({ type: on, sort: sorts(65) }),
      'limit-exceeded',
      'newer: 65 sort entries',
    );
    assert.strictEqual(
      code({ filter: { type: on }, sort: sorts(65) }),
      'accepted',
      'older: 65 sort entries',
    );
    assert.strictEqual(
      code({ filter: { type: on }, sort: sorts(801) }),
      'limit-exceeded',
      'older: 801 sort entries, past the target list',
    );
    // a matches term
    assert.strictEqual(
      code({ type: on, filter: { matches: 'w '.repeat(5_001) } }),
      'limit-exceeded',
      'newer: a term of 10,002 characters',
    );
    assert.strictEqual(
      code({ filter: { on, matches: 'w '.repeat(5_001) } }),
      'accepted',
      'older: a term of 10,002 characters',
    );
    assert.strictEqual(
      code({ filter: { on, matches: 'w '.repeat(50_000) } }),
      'limit-exceeded',
      'older: a term of 100,000 characters',
    );
    // nesting
    assert.strictEqual(
      code({ type: on, filter: nested(300) }),
      'limit-exceeded',
      'newer: every 300 deep',
    );
    assert.strictEqual(
      code({ filter: nested(300) }),
      'accepted',
      'older: every 300 deep',
    );
    assert.strictEqual(
      code({ filter: nested(1_100) }),
      'limit-exceeded',
      'older: every 1,100 deep',
    );
  });

  // `main` counted every match of every page (one COUNT(*)), with no cap and
  // no mode to ask for. A saved query keeps that answer: the older spelling
  // reaches the engine with no `total`, which the engine counts exactly. The
  // newer spelling, which has no saved answers, counts to the cap unless it
  // names a mode: its lowering writes `total: 'capped'`. A counts-only page
  // (`size: 0`) is counted exactly in both. The counts themselves are pinned
  // against the database in query-bounds-cases ("page.total").
  test('a member main never had makes the whole query the newer spelling', function (assert) {
    // The older spelling is exactly main's grammar (ADR 022 §1.7). `on`
    // anchors with `facets` beside them are a newer query, read strictly.
    let mixed = {
      filter: { on, eq: { name: 'a' } },
      facets: [{ by: 'name' }],
      page: { size: 10 },
    };
    assert.true(usesNewSyntax(mixed), 'facets: the newer spelling');
    assert.deepEqual(
      lowerQuery(mixed).query.page,
      { size: 10, total: 'capped' },
      "so its page takes the newer default, `total: 'capped'`",
    );
    assert.throws(
      () =>
        assertQuery({
          ...mixed,
          filter: { on, eq: { name: 'a' }, note: 'x' },
        }),
      /unknown member "note"/,
      'and a member the older spelling would ignore is refused',
    );
    assert.throws(
      () => assertQuery({ ...mixed, page: { size: 10, cursor: 'abc' } }),
      /unknown member "cursor"/,
      'a page cursor too',
    );
    // the same query rewritten in the newer form is accepted
    let rewritten = {
      type: on,
      filter: { eq: { name: 'a' } },
      facets: [{ by: 'name' }],
      page: { size: 10 },
    };
    assertQuery(rewritten);
    assert.deepEqual(
      lowerQuery(rewritten).query.filter,
      { on, every: [{ eq: { name: 'a' } }] },
      'it lowers to the same condition, anchored by the top-level type',
    );
    for (let member of [
      { collapse: 'name' },
      { let: {} },
      { explain: true },
      { timeZone: 'UTC' },
      { page: { size: 10, total: 'exact' } },
      { page: { size: 10, exactTotal: true } },
    ]) {
      assert.true(
        usesNewSyntax({ filter: { on, eq: { name: 'a' } }, ...member }),
        JSON.stringify(member),
      );
    }
    for (let node of [
      { on, near: { embedding: [1] } },
      { on, matches: 'a', prefix: true },
      { on, pattern: { name: 'a*' } },
    ]) {
      assert.true(usesNewSyntax({ filter: node }), JSON.stringify(node));
    }
    assert.false(
      usesNewSyntax({ filter: { on, eq: { name: 'a' } }, page: { cursor: 1 } }),
      'an unknown page member is not a V2 member: main ignored it, and still does',
    );
  });

  test('an author naming the type with on beside a V2 member is refused with the rewrite; the server reads the engine form', function (assert) {
    let mixed = {
      filter: { on, eq: { name: 'a' } },
      facets: [{ by: 'name' }],
    };
    assert.throws(
      () => assertAuthoredQuerySpelling(mixed),
      (err: any) =>
        err.code === 'mixed-spelling' &&
        err.message.includes('{ "type": ' + JSON.stringify(on)),
    );
    // the engine's form of a newer query is the same shape, so the server
    // reads it, strictly
    assertQuery(mixed);
    assertAuthoredQuerySpelling({ type: on, ...mixed });
    assertAuthoredQuerySpelling({
      filter: { every: [{ on, eq: { name: 'a' } }] },
      facets: [{ by: 'name' }],
    });
    assertAuthoredQuerySpelling({ filter: { on, eq: { name: 'a' } } });
    assert.throws(
      () =>
        assertAuthoredQuerySpelling({
          type: on,
          let: { $x: { from: mixed, select: 'name' } },
        }),
      /let\.\$x\.from/,
      'a binding is an author query too',
    );
  });

  test('a page naming no total: exact in the older spelling, as on main; capped in the newer', function (assert) {
    let older = { filter: { on, eq: { name: 'a' } }, page: { size: 10 } };
    assert.deepEqual(
      parseSearchEntryQueryFromPayload({
        filter: { 'item.on': on, eq: { 'item.name': 'a' } },
        page: { size: 10 },
      }).itemQuery.page,
      { size: 10 },
      'an older request reaches the engine with no mode: counted exactly',
    );
    assert.deepEqual(
      searchEntryWireQueryFromQuery(older as Query).page,
      { size: 10 },
      'wired as it was written',
    );
    let newer = { type: on, filter: { eq: { name: 'a' } }, page: { size: 10 } };
    assert.deepEqual(
      lowerQuery(newer).query.page,
      { size: 10, total: 'capped' },
      'the newer spelling lowers to a capped count',
    );
    assert.deepEqual(
      parseSearchEntryQueryFromPayload({
        filter: { 'item.on': on, eq: { 'item.name': 'a' } },
        sort: [{ blend: [{ by: 'item.name' }] }],
        page: { size: 10 },
      }).itemQuery.page,
      { size: 10, total: 'capped' },
      'a newer request is capped',
    );
    for (let total of ['exact', 'capped', 'none'] as const) {
      assert.deepEqual(
        lowerQuery({ ...newer, page: { size: 10, total } }).query.page,
        { size: 10, total },
        `newer: a named ${total} wins`,
      );
      assert.deepEqual(
        parseSearchEntryQueryFromPayload({
          filter: { 'item.on': on },
          page: { size: 10, total },
        }).itemQuery.page,
        { size: 10, total },
        `older: a named ${total} wins`,
      );
    }
    assert.deepEqual(
      lowerQuery({ ...newer, page: { size: 10, exactTotal: true } }).query.page,
      { size: 10, exactTotal: true },
      'newer: exactTotal still asks for an exact count',
    );
    assert.deepEqual(
      lowerQuery({ ...newer, page: { size: 0 } }).query.page,
      { size: 0 },
      'newer: a counts-only page is counted exactly',
    );
  });
});
