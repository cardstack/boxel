import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  SEARCH_TEXT_KEY,
  SearchRequestError,
  VectorSerializer,
  VirtualNetwork,
  assertQuery,
  baseCardRef,
  facetFieldSpecsOf,
  internalKeyFor,
  logSearchResponse,
  rri,
  setVectorSearchSettings,
  type DBAdapter,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  applySearchPageBound,
  applyServerSearchPageBound,
} from '@cardstack/runtime-common/search-bounds';
import {
  lowerQuery,
  usesNewSyntax,
} from '@cardstack/runtime-common/query-syntax';
import { parseSearchEntryQueryFromPayload } from '@cardstack/runtime-common/search-entry';

import { setupDB } from './helpers/index.ts';

// What a malformed query is refused with. docs/search.md (Refusals) promises
// every refusal a code a caller can act on, so each row here asserts the
// code, through both doors a query comes in by: `assertQuery` (a card's own
// search) and the search wire's parser (a request body), where the member
// exists on the wire.
//
// query-error-codes-test.ts holds the first table of mistakes; this file
// covers what it does not: the codes no test asserted, the strict reading of
// the newer spelling at every level of a query, a wrong kind of value for
// each member, values out of range, field names chosen to break a lookup,
// and inputs that are not queries at all.
//
// Each row says where the refusal happens: [validation] needs no index;
// [run] is raised only when the query runs, and those are in the module at
// the end, against a real index.
//
// An expected code is the one the docs' table gives the mistake. A value of
// the wrong kind or out of range is `invalid-value`; more of something than
// a query may have is `limit-exceeded`; a malformed page is `invalid-page`;
// a filter (or sort entry) that is a number, a string or null is
// `missing-member`, as query-error-codes-test.ts already holds it, and a
// list in its place is a value of the wrong kind.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const realm = 'http://query-refusals/';
const T = ref(`${realm}shop`, 'Listing');
const noteRef = ref(`${realm}shop`, 'Note');

type Q = Record<string, any>;

// How a call ended: not refused, refused as a query (with or without a
// code), or failed some other way.
interface Outcome {
  refused: boolean;
  kind: string;
  code: string | undefined;
  message: string;
}

function outcome(run: () => unknown): Outcome {
  try {
    run();
  } catch (e) {
    return describeError(e);
  }
  return { refused: false, kind: 'accepted', code: undefined, message: '' };
}

function describeError(e: unknown): Outcome {
  let message = String((e as Error | undefined)?.message ?? e);
  if (e instanceof InvalidQueryError) {
    return { refused: true, kind: 'InvalidQueryError', code: e.code, message };
  }
  if (e instanceof SearchRequestError) {
    return {
      refused: true,
      kind: 'SearchRequestError',
      code: e.queryCode,
      message,
    };
  }
  return {
    refused: false,
    kind: (e as Error | undefined)?.constructor?.name ?? typeof e,
    code: undefined,
    message,
  };
}

const viaAssert = (query: unknown) => outcome(() => assertQuery(query as any));
// A request body is JSON: what cannot be written in JSON never arrives.
const viaWire = (payload: unknown) =>
  outcome(() =>
    parseSearchEntryQueryFromPayload(JSON.parse(JSON.stringify(payload))),
  );

function isRefusedWith(
  assert: Assert,
  got: Outcome,
  code: string,
  door: string,
) {
  assert.true(
    got.refused,
    `${door}: refused as a query (was: ${got.kind}${got.message ? `, ${got.message.slice(0, 140)}` : ''})`,
  );
  assert.strictEqual(
    got.code,
    code,
    `${door}: the code (${got.message.slice(0, 140)})`,
  );
}

// One mistake: the query, the code, and whether the wire can carry it. Rows
// are in the newer spelling (a top-level `type`), which both doors read, so
// one object goes through both unless `wire` says otherwise.
interface Mistake {
  name: string;
  query: unknown;
  code: string;
  // false: the member does not exist on the wire (or JSON cannot hold the
  // value). Otherwise the payload, when it differs from the query.
  wire?: unknown;
}

const f = (filter: unknown, more: Q = {}): Q => ({ type: T, filter, ...more });
const s = (sort: unknown, more: Q = {}): Q => ({ type: T, sort, ...more });
const top = (more: Q): Q => ({ type: T, ...more });
const kind = { eq: { kind: 'lamp' } };
const binding = { from: { type: T, filter: kind }, select: 'kind' };
const usingA = { in: { kind: '$a' } };

// ---- codes no test asserted -----------------------------------------------

const UNASSERTED_CODES: Mistake[] = [
  {
    name: 'a near sort with no type anywhere',
    query: { sort: [{ by: 'embedding', near: [1, 0, 0] }] },
    wire: { sort: [{ by: 'item.embedding', near: [1, 0, 0] }] },
    code: 'needs-type',
  },
  {
    name: 'a field sort with no type anywhere',
    query: { sort: [{ by: 'price' }] },
    wire: { sort: [{ by: 'item.price' }] },
    code: 'sort-needs-type',
  },
  {
    name: 'a field sort with no type anywhere, beside a newer spelling',
    query: { filter: { exists: 'price' }, sort: [{ by: 'price' }] },
    code: 'sort-needs-type',
  },
  {
    name: 'a field sort inside a blend with no type anywhere',
    query: { sort: [{ blend: [{ by: 'price' }] }] },
    code: 'sort-needs-type',
  },
  {
    // "$topp" names no binding, so it is text, and an `in` takes a list
    name: 'an `in` of a string that names no declared binding',
    query: top({
      let: { $top: binding },
      filter: { in: { kind: '$topp' } },
    }),
    code: 'invalid-value',
  },
  {
    name: 'an `in` of "$a" when there is no let at all',
    query: f({ in: { kind: '$a' } }),
    code: 'invalid-value',
  },
  {
    name: 'a binding declared without its $',
    query: top({
      let: { anchor: { from: { type: T, filter: kind }, one: true } },
      filter: { range: { price: { lt: '$anchor.price' } } },
    }),
    code: 'invalid-value',
  },
  ...['$this', '$literal'].map((name) => ({
    name: `a binding named ${name}, which is reserved`,
    query: top({ let: { [name]: binding } }),
    code: 'invalid-value',
  })),
  {
    name: 'a binding read with the { $let } object',
    query: top({
      let: { $top: binding },
      filter: { in: { kind: { $let: 'top' } } },
    }),
    code: 'unknown-key',
  },
  {
    name: 'a one-card binding read with the { $let, path } object',
    query: top({
      let: { $it: { from: { type: T, filter: kind }, one: true } },
      filter: { eq: { kind: { $let: 'it', path: 'kind' } } },
    }),
    code: 'unknown-key',
  },
  ...[3, null, ['$a'], { text: 'x' }].map((v) => ({
    name: `a $literal of ${JSON.stringify(v)}`,
    query: f({ eq: { kind: { $literal: v } } }),
    code: 'invalid-value',
  })),
  {
    name: 'a $literal beside another member',
    query: f({ eq: { kind: { $literal: 'lamp', also: 1 } } }),
    code: 'invalid-value',
  },
  {
    name: 'a range bound that is an object',
    query: f({ range: { price: { gt: {} } } }),
    code: 'invalid-json',
  },
  {
    name: 'a range bound that is a list',
    query: f({ range: { price: { gte: [1, 2] } } }),
    code: 'invalid-json',
  },
  {
    name: 'an eq value JSON cannot hold (undefined)',
    query: f({ eq: { kind: undefined } }),
    wire: false,
    code: 'invalid-json',
  },
  {
    name: 'an eq value JSON cannot hold (a function)',
    query: f({ eq: { kind: () => 'lamp' } }),
    wire: false,
    code: 'invalid-json',
  },
  {
    name: 'an eq value JSON cannot hold, deep inside an object',
    query: f({ eq: { kind: { a: [{ b: BigInt(1) }] } } }),
    wire: false,
    code: 'invalid-json',
  },
  {
    name: 'an in value JSON cannot hold',
    query: f({ in: { kind: ['lamp', Symbol('x')] } }),
    wire: false,
    code: 'invalid-json',
  },
  {
    name: 'a contains value JSON cannot hold',
    query: f({ contains: { kind: undefined } }),
    wire: false,
    code: 'invalid-json',
  },
];

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  // eq, in, contains, range
  ...[3, null, 'lamp', true].map((v) => ({
    name: `eq: ${JSON.stringify(v)}`,
    query: f({ eq: v }),
    code: 'invalid-value',
  })),
  {
    name: 'eq: a list where a map of fields goes',
    query: f({ eq: ['lamp'] }),
    code: 'invalid-value',
  },
  ...[3, null, 'lamp'].map((v) => ({
    name: `in: ${JSON.stringify(v)}`,
    query: f({ in: v }),
    code: 'invalid-value',
  })),
  ...[null, 3, { a: 1 }].map((v) => ({
    name: `in: a field's value is ${JSON.stringify(v)}, not a list`,
    query: f({ in: { kind: v } }),
    code: 'invalid-value',
  })),
  ...[3, null, 'lamp'].map((v) => ({
    name: `contains: ${JSON.stringify(v)}`,
    query: f({ contains: v }),
    code: 'invalid-value',
  })),
  ...[5, null, 'cheap'].map((v) => ({
    name: `range: ${JSON.stringify(v)}`,
    query: f({ range: v }),
    code: 'invalid-value',
  })),
  ...[5, null, 'cheap'].map((v) => ({
    name: `range: a field's bounds are ${JSON.stringify(v)}`,
    query: f({ range: { price: v } }),
    code: 'invalid-value',
  })),
  // matches and its options
  ...[3, null, {}, ['lamp'], true].map((v) => ({
    name: `matches: ${JSON.stringify(v)}`,
    query: f({ matches: v }),
    code: 'invalid-value',
  })),
  // `typeahead` is gone: type-ahead is `{ matches, prefix: true, scope:
  // 'title' }`. Refused in both spellings, on the wire, and wherever a filter
  // goes, whatever its value.
  ...['lam', 3, null, {}, ['lam']].map((v) => ({
    name: `typeahead: ${JSON.stringify(v)}`,
    query: f({ typeahead: v }),
    code: 'unknown-key',
  })),
  {
    name: 'typeahead in the older spelling',
    query: { filter: { on: T, typeahead: 'lam' } },
    wire: { filter: { 'item.on': T, typeahead: 'lam' } },
    code: 'unknown-key',
  },
  {
    name: 'typeahead under any',
    query: f({ any: [{ typeahead: 'lam' }, { eq: { kind: 'lamp' } }] }),
    code: 'unknown-key',
  },
  {
    name: 'typeahead under not',
    query: f({ not: { typeahead: 'lam' } }),
    code: 'unknown-key',
  },
  {
    name: 'typeahead beside typos',
    query: f({ typeahead: 'lam', typos: true }),
    code: 'unknown-key',
  },
  ...['yes', 1, null].map((v) => ({
    name: `prefix: ${JSON.stringify(v)}`,
    query: f({ matches: 'lamp', prefix: v }),
    code: 'invalid-value',
  })),
  ...['yes', 1, null].map((v) => ({
    name: `typos: ${JSON.stringify(v)} beside matches`,
    query: f({ matches: 'lamp', typos: v }),
    code: 'invalid-value',
  })),
  {
    name: 'typos: "yes" beside a type-ahead matches',
    query: f({ matches: 'lam', prefix: true, scope: 'title', typos: 'yes' }),
    code: 'invalid-value',
  },
  ...['body', 3, null, ['title']].map((v) => ({
    name: `scope: ${JSON.stringify(v)}`,
    query: f({ matches: 'lamp', scope: v }),
    code: 'invalid-value',
  })),
  ...[3, null, 'a.b', ''].map((v) => ({
    name: `within: ${JSON.stringify(v)}`,
    query: f({ matches: 'lamp', within: v }),
    code: 'invalid-value',
  })),
  ...['title', 3, null, [3], [null]].map((v) => ({
    name: `fields: ${JSON.stringify(v)}`,
    query: f({ matches: 'lamp', fields: v }),
    code: 'invalid-value',
  })),
  // any, every, not
  ...[{}, null, 'x', 3].map((v) => ({
    name: `any: ${JSON.stringify(v)}`,
    query: f({ any: v }),
    code: 'invalid-value',
  })),
  ...[{}, null, 'x', 3].map((v) => ({
    name: `every: ${JSON.stringify(v)}`,
    query: f({ every: v }),
    code: 'invalid-value',
  })),
  ...[3, null, 'x', []].map((v) => ({
    name: `a member of any is ${JSON.stringify(v)}`,
    query: f({ any: [kind, v] }),
    code: Array.isArray(v) ? 'invalid-value' : 'missing-member',
  })),
  ...[3, null, 'x', [], [kind]].map((v) => ({
    name: `not: ${JSON.stringify(v)}`,
    query: f({ not: v }),
    code: Array.isArray(v) ? 'invalid-value' : 'missing-member',
  })),
  // pattern, regex
  ...(['pattern', 'regex'] as const).flatMap((op) => [
    ...['LMP-*', 3, null, ['LMP-*']].map((v) => ({
      name: `${op}: ${JSON.stringify(v)}`,
      query: f({ [op]: v }),
      code: 'invalid-value',
    })),
    ...[3, null, {}, ['a'], ''].map((v) => ({
      name: `${op}: a field's value is ${JSON.stringify(v)}`,
      query: f({ [op]: { sku: v } }),
      code: 'invalid-value',
    })),
    {
      name: `${op}: no field`,
      query: f({ [op]: {} }),
      code: 'missing-member',
    },
  ]),
  // near
  ...[[1, 0], 3, null, 'embedding'].map((v) => ({
    name: `near: ${JSON.stringify(v)}`,
    query: f({ near: v }),
    code: 'invalid-value',
  })),
  ...[null, [1, 0], 3, {}].map((v) => ({
    name: `near: a field's value is ${JSON.stringify(v)}`,
    query: f({ near: { embedding: v } }),
    code: 'invalid-value',
  })),
  ...['x', 3, null, {}, [1, 'a'], [1, null]].map((v) => ({
    name: `near: to is ${JSON.stringify(v)}`,
    query: f({ near: { embedding: { to: v } } }),
    code: 'invalid-value',
  })),
  ...['high', null, 2, -1.5].map((v) => ({
    name: `near: minSimilarity ${JSON.stringify(v)}`,
    query: f({ near: { embedding: { to: [1, 0], minSimilarity: v } } }),
    code: 'invalid-value',
  })),
  {
    name: 'near: the k nearest is not a filter',
    query: f({ near: { embedding: { to: [1, 0], k: 5 } } }),
    code: 'unknown-key',
  },
  {
    name: 'near: two fields in one filter',
    query: f({ near: { a: { to: [1, 0] }, b: { to: [1, 0] } } }),
    code: 'conflicting-members',
  },
  // linkedFrom
  ...[
    'x',
    null,
    3,
    {},
    { card: 'Wishlist/mine', field: 'items' },
    { card: '@scope', field: 'items' },
    { card: '$REALM/', field: 'items' },
    { card: 'http://a.test/Wishlist /mine', field: 'items' },
    { card: 3, field: 'items' },
    { card: 'http://a.test/Wishlist/mine' },
    { card: 'http://a.test/Wishlist/mine', field: 3 },
    { card: 'http://a.test/Wishlist/mine', field: 'a..b' },
  ].map((v) => ({
    name: `linkedFrom: ${JSON.stringify(v)}`,
    query: f({ linkedFrom: v }),
    code: 'invalid-value',
  })),
  // exists, missing
  ...[3, null, ['price'], {}].flatMap((v) => [
    {
      name: `exists: ${JSON.stringify(v)}`,
      query: f({ exists: v }),
      code: 'invalid-filter',
    },
    {
      name: `missing: ${JSON.stringify(v)}`,
      query: f({ missing: v }),
      code: 'invalid-filter',
    },
  ]),
  // the filter itself
  ...['x', 3, null, [], [[]], true].map((v) => ({
    name: `filter: ${JSON.stringify(v)}`,
    query: top({ filter: v }),
    code: Array.isArray(v) ? 'invalid-value' : 'missing-member',
  })),
  // sort
  ...['price', 3, null].map((v) => ({
    name: `sort: ${JSON.stringify(v)}`,
    query: top({ sort: v }),
    code: 'invalid-value',
  })),
  ...[3, null, 'price'].map((v) => ({
    name: `a sort entry is ${JSON.stringify(v)}`,
    query: s([v]),
    code: 'missing-member',
  })),
  { name: 'a sort entry with no by', query: s([{}]), code: 'missing-member' },
  ...[3, null, ['price'], {}].map((v) => ({
    name: `sort by: ${JSON.stringify(v)}`,
    query: s([{ by: v }]),
    code: 'invalid-value',
  })),
  ...[1, 'up', null, 'ASC'].map((v) => ({
    name: `sort direction: ${JSON.stringify(v)}`,
    query: s([{ by: 'price', direction: v }]),
    code: 'invalid-value',
  })),
  ...['top', true, null, 1].map((v) => ({
    name: `sort missing: ${JSON.stringify(v)}`,
    query: s([{ by: 'price', missing: v }]),
    code: 'invalid-value',
  })),
  ...['x', 3, {}, [1, 'a']].map((v) => ({
    name: `a near sort's target is ${JSON.stringify(v)}`,
    query: s([{ by: 'embedding', near: v }]),
    code: 'invalid-value',
  })),
  // blend, boost, relevance
  ...['heavy', null, '2'].map((v) => ({
    name: `a blend signal's weight is ${JSON.stringify(v)}`,
    query: s([{ blend: [{ by: 'price', weight: v }] }]),
    code: 'invalid-value',
  })),
  ...[0, -1, '60', null].map((v) => ({
    name: `a blend's k is ${JSON.stringify(v)}`,
    query: s([{ blend: [{ by: 'price' }], k: v }]),
    code: 'invalid-value',
  })),
  ...['sum', 3, null].map((v) => ({
    name: `a blend's method is ${JSON.stringify(v)}`,
    query: s([{ blend: [{ by: 'price' }], method: v }]),
    code: 'invalid-value',
  })),
  {
    name: 'a blend of nothing',
    query: s([{ blend: [] }]),
    code: 'missing-member',
  },
  ...['price', 3].map((v) => ({
    name: `blend: ${JSON.stringify(v)}`,
    query: s([{ blend: v }]),
    code: 'invalid-value',
  })),
  ...[null, 3, 'lamp'].map((v) => ({
    name: `boost: ${JSON.stringify(v)}`,
    query: s([{ blend: [{ boost: v }] }]),
    code: 'missing-member',
  })),
  ...['high', null, [1]].map((v) => ({
    name: `a relevance weight is ${JSON.stringify(v)}`,
    query: s([{ relevance: { text: v } }], { filter: { matches: 'lamp' } }),
    code: 'invalid-value',
  })),
  {
    name: 'a relevance signal that does not exist',
    query: s([{ relevance: { txt: 1 } }], { filter: { matches: 'lamp' } }),
    code: 'unknown-key',
  },
  ...['x', 3, {}].map((v) => ({
    name: `a relevance sort's near is ${JSON.stringify(v)}`,
    query: s([{ relevance: true, near: v }], { filter: { matches: 'lamp' } }),
    code: 'invalid-value',
  })),
  ...[3, null, '', '   ', ['price'], {}].map((v) => ({
    name: `expression: ${JSON.stringify(v)}`,
    query: s([{ expression: v }]),
    code: 'invalid-expression',
  })),
  // `placement` is gone: every expression runs in SQL
  ...['sql', 'top', 'gpu', 3, null].map((v) => ({
    name: `an expression's placement is ${JSON.stringify(v)}`,
    query: s([{ expression: 'price * 2', placement: v }]),
    code: 'unknown-key',
  })),
  {
    name: 'an expression with a text function',
    query: s([{ expression: 'LEN(name)' }]),
    code: 'expression-unsupported',
  },
  {
    name: 'an expression whose value can be text',
    query: s([{ expression: 'IF(price > 1, price, "")' }]),
    code: 'expression-unsupported',
  },
  {
    name: 'peers. in an expression sort with no top',
    query: s([{ expression: 'price / stats.price.median' }]),
    code: 'expression-placement',
  },
  {
    name: 'an expression with top that is not the first sort entry',
    query: s([{ by: 'price' }, { expression: 'price', top: 5 }]),
    code: 'expression-placement',
  },
  {
    name: 'a blend signal with top',
    query: s([{ blend: [{ expression: 'price', top: 5 }] }]),
    code: 'invalid-nesting',
  },
  {
    name: 'arithmetic on a peers list',
    query: s([{ expression: 'peers.price * 2', compare: { by: 'kind' } }]),
    code: 'expression-unsupported',
  },
  // page
  ...[5, null, 'two', true].map((v) => ({
    name: `page: ${JSON.stringify(v)}`,
    query: top({ page: v }),
    code: 'invalid-page',
  })),
  ...['ten', 1.5, -1, null, [10], {}, true].map((v) => ({
    name: `page.size: ${JSON.stringify(v)}`,
    query: top({ page: { size: v } }),
    code: 'invalid-page',
  })),
  ...['two', 1.5, -1, null, [1]].map((v) => ({
    name: `page.number: ${JSON.stringify(v)}`,
    query: top({ page: { size: 10, number: v } }),
    code: 'invalid-page',
  })),
  ...['all', true, null, 3].map((v) => ({
    name: `page.total: ${JSON.stringify(v)}`,
    query: top({ page: { size: 10, total: v } }),
    code: 'invalid-page',
  })),
  ...['yes', 1, null].map((v) => ({
    name: `page.exactTotal: ${JSON.stringify(v)}`,
    query: top({ page: { size: 10, exactTotal: v } }),
    code: 'invalid-page',
  })),
  // facets
  ...[{}, 'kind', 3, null].map((v) => ({
    name: `facets: ${JSON.stringify(v)}`,
    query: top({ facets: v }),
    code: 'invalid-value',
  })),
  ...[3, null, 'kind', ['kind'], {}].map((v) => ({
    name: `a facet is ${JSON.stringify(v)}`,
    query: top({ facets: [v] }),
    code: 'invalid-value',
  })),
  ...[3, null, ['kind'], ''].map((v) => ({
    name: `facet by: ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: v }] }),
    code: 'invalid-value',
  })),
  ...[0, -1, 1001, 1.5, '5', null].map((v) => ({
    name: `facet size: ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: 'kind', size: v }] }),
    code: 'invalid-value',
  })),
  ...(
    [
      ['own', true],
      ['own', 'keep'],
      ['stats', 'yes'],
      ['stats', 1],
      ['missing', 'yes'],
      ['prefix', 3],
      ['prefix', ['la']],
      ['order', 'alpha'],
      ['order', 1],
      ['interval', 'hour'],
      ['interval', 3],
      ['measure', 'price'],
      ['measure', { avg: 3 }],
      ['measure', { median: 'price' }],
      ['measure', { avg: 'price', max: 'price' }],
      ['measure', {}],
      ['measure', { avg: 'a..b' }],
    ] as [string, unknown][]
  ).map(([member, v]) => ({
    name: `facet ${member}: ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: 'kind', [member]: v }] }),
    code: 'invalid-value',
  })),
  ...[{}, 'cheap', 3].map((v) => ({
    name: `facet ranges: ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: 'price', ranges: v }] }),
    code: 'invalid-value',
  })),
  ...[3, null, 'cheap', [0, 10]].map((v) => ({
    name: `a facet range is ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: 'price', ranges: [v] }] }),
    code: 'invalid-value',
  })),
  ...[null, true, [1], {}].map((v) => ({
    name: `a facet range's bound is ${JSON.stringify(v)}`,
    query: top({ facets: [{ by: 'price', ranges: [{ from: v }] }] }),
    code: 'invalid-value',
  })),
  ...[NaN, Infinity, -Infinity].map((v) => ({
    name: `a facet range's bound is ${String(v)}`,
    query: top({ facets: [{ by: 'price', ranges: [{ to: v }] }] }),
    wire: false,
    code: 'invalid-value',
  })),
  {
    name: 'a facet range with a key that is not text',
    query: top({ facets: [{ by: 'price', ranges: [{ to: 10, key: 3 }] }] }),
    code: 'invalid-value',
  },
  {
    name: 'a facet range with neither end',
    query: top({ facets: [{ by: 'price', ranges: [{ key: 'all' }] }] }),
    code: 'missing-member',
  },
  {
    name: 'a facet ordered by a measure it does not have',
    query: top({ facets: [{ by: 'kind', order: 'measure' }] }),
    code: 'missing-member',
  },
  // collapse
  ...[3, null, ['kind'], true, {}].map((v) => ({
    name: `collapse: ${JSON.stringify(v)}`,
    query: top({ collapse: v }),
    code: 'invalid-value',
  })),
  ...[3, null, ['kind'], ''].map((v) => ({
    name: `collapse by: ${JSON.stringify(v)}`,
    query: top({ collapse: { by: v } }),
    code: 'invalid-value',
  })),
  ...[0, -1, 11, 1.5, '2', null].map((v) => ({
    name: `collapse keep: ${JSON.stringify(v)}`,
    query: top({ collapse: { by: 'kind', keep: v } }),
    code: 'invalid-value',
  })),
  // `rerank` is gone: re-ranking is a sort entry with top
  ...['price', { expression: 'price' }, { expression: 'price', top: 5 }].map(
    (v) => ({
      name: `a top-level rerank: ${JSON.stringify(v)}`,
      query: top({ rerank: v }),
      code: 'unknown-key',
    }),
  ),
  // a window (an expression sort entry with top or compare)
  ...[3, null, '', '  ', ['price']].map((v) => ({
    name: `window expression: ${JSON.stringify(v)}`,
    query: s([{ expression: v, top: 5 }]),
    code: 'invalid-expression',
  })),
  ...[0, -1, 501, 1.5, '50', null].map((v) => ({
    name: `window top: ${JSON.stringify(v)}`,
    query: s([{ expression: 'price', top: v }]),
    code: 'invalid-value',
  })),
  ...['up', 1, null].map((v) => ({
    name: `window direction: ${JSON.stringify(v)}`,
    query: s([{ expression: 'price', top: 5, direction: v }]),
    code: 'invalid-value',
  })),
  ...(
    [
      3,
      null,
      'kind',
      [],
      { by: 3 },
      { by: 'a..b' },
      { near: 3 },
      { near: 'a b' },
      { k: 5 },
      { minSimilarity: 0.5 },
      { near: 'embedding', k: 0 },
      { near: 'embedding', k: 101 },
      { near: 'embedding', k: 1.5 },
      { near: 'embedding', minSimilarity: 2 },
      { near: 'embedding', minSimilarity: 'high' },
    ] as unknown[]
  ).map((v) => ({
    name: `window compare: ${JSON.stringify(v)}`,
    query: s([{ expression: 'price', compare: v }]),
    code: 'invalid-value',
  })),
  ...[3, 'lamp', []].map((v) => ({
    name: `window compare filter: ${JSON.stringify(v)}`,
    query: s([{ expression: 'price', compare: { filter: v } }]),
    code: Array.isArray(v) ? 'invalid-value' : 'missing-member',
  })),
  // let
  ...[[], 3, 'a', null].map((v) => ({
    name: `let: ${JSON.stringify(v)}`,
    query: top({ let: v }),
    code: 'invalid-value',
  })),
  ...['1a', 'a-b', 'a b', 'a.b', ''].map((v) => ({
    name: `a binding named ${JSON.stringify(v)}`,
    query: top({ let: { [v]: binding } }),
    code: 'invalid-value',
  })),
  ...[3, null, 'kind', []].map((v) => ({
    name: `a binding is ${JSON.stringify(v)}`,
    query: top({ let: { $a: v } }),
    code: 'invalid-value',
  })),
  ...[3, null, ['kind'], 'a..b', ''].map((v) => ({
    name: `a binding's select is ${JSON.stringify(v)}`,
    query: top({ let: { $a: { ...binding, select: v } }, filter: usingA }),
    code: 'invalid-value',
  })),
  ...[false, 1, 'yes', null].map((v) => ({
    name: `a binding's one is ${JSON.stringify(v)}`,
    query: top({ let: { $a: { from: binding.from, one: v } } }),
    code: 'invalid-value',
  })),
  ...[3, null, 'Listing', []].map((v) => ({
    name: `a binding's from is ${JSON.stringify(v)}`,
    query: top({ let: { $a: { from: v, select: 'kind' } }, filter: usingA }),
    code: 'invalid-value',
  })),
  ...[3, null, [], {}, { size: '10' }, { size: 1.5 }].map((v) => ({
    name: `a binding's page is ${JSON.stringify(v)}`,
    query: top({
      let: { $a: { from: { ...binding.from, page: v }, select: 'kind' } },
      filter: usingA,
    }),
    code: 'invalid-value',
  })),
  // explain, type
  ...['yes', 1, null].map((v) => ({
    name: `explain: ${JSON.stringify(v)}`,
    query: top({ explain: v }),
    code: 'invalid-value',
  })),
  ...[
    'Listing',
    3,
    null,
    {},
    [],
    { module: '', name: '' },
    { name: 'Listing' },
  ].map((v) => ({
    name: `type: ${JSON.stringify(v)}`,
    query: { type: v, filter: kind },
    code: 'invalid-type',
  })),
  ...['Listing', 3, {}, { module: '', name: '' }].map((v) => ({
    name: `a filter's on is ${JSON.stringify(v)}`,
    query: f({ on: v, eq: { kind: 'lamp' } }),
    wire: f({ 'item.on': v, eq: { kind: 'lamp' } }),
    code: 'invalid-type',
  })),
  ...['Listing', 3, {}].map((v) => ({
    name: `a sort entry's on is ${JSON.stringify(v)}`,
    query: s([{ by: 'price', on: v }]),
    wire: s([{ by: 'price', 'item.on': v }]),
    code: 'invalid-type',
  })),
  ...['Listing', 3, {}].map((v) => ({
    name: `a collapse's on is ${JSON.stringify(v)}`,
    query: top({ collapse: { by: 'kind', on: v } }),
    wire: top({ collapse: { by: 'kind', 'item.on': v } }),
    code: 'invalid-type',
  })),
];

// ---- members that cannot go together --------------------------------------

const CONFLICTS: Mistake[] = [
  {
    name: 'eq and range in one filter',
    query: f({ eq: { kind: 'lamp' }, range: { price: { gt: 1 } } }),
    code: 'conflicting-members',
  },
  {
    name: 'matches and typeahead in one filter',
    query: f({ matches: 'lamp', typeahead: 'lam' }),
    code: 'unknown-key',
  },
  {
    name: 'pattern and regex in one filter',
    query: f({ pattern: { sku: 'L*' }, regex: { sku: '^L' } }),
    code: 'conflicting-members',
  },
  {
    name: 'any and every in one filter',
    query: f({ any: [kind], every: [kind] }),
    code: 'conflicting-members',
  },
  {
    name: 'not beside eq',
    query: f({ not: kind, eq: { kind: 'lamp' } }),
    code: 'conflicting-members',
  },
  {
    name: 'exists beside eq',
    query: f({ exists: 'price', eq: { kind: 'lamp' } }),
    code: 'invalid-filter',
  },
  {
    name: 'exists beside missing',
    query: f({ exists: 'price', missing: 'kind' }),
    code: 'invalid-filter',
  },
  ...(
    [
      ['typos', true, { eq: { kind: 'lamp' } }],
      ['typos', true, { pattern: { sku: 'L*' } }],
      ['typos', true, { range: { price: { gt: 1 } } }],
      ['prefix', true, { contains: { kind: 'la' } }],
      ['scope', 'title', { eq: { kind: 'lamp' } }],
      ['within', 'segments', { eq: { kind: 'lamp' } }],
      ['fields', ['title'], { eq: { kind: 'lamp' } }],
      ['fields', ['title'], { matches: 'lam', prefix: true }],
    ] as [string, unknown, Q][]
  ).map(([option, v, filter]) => ({
    name: `${option} beside ${Object.keys(filter)[0]}`,
    query: f({ ...filter, [option]: v }),
    code: 'conflicting-members',
  })),
  {
    name: 'scope and within on one matches',
    query: f({ matches: 'lamp', scope: 'title', within: 'segments' }),
    code: 'conflicting-members',
  },
  ...(
    [
      ['scope', 'title'],
      ['within', 'segments'],
      ['prefix', true],
    ] as [string, unknown][]
  ).map(([option, v]) => ({
    name: `matches with fields and ${option}`,
    query: f({ matches: 'lamp', fields: ['title'], [option]: v }),
    code: 'conflicting-members',
  })),
  {
    name: 'a blend with a type of its own',
    query: s([{ blend: [{ by: 'price' }], on: T }]),
    wire: s([{ blend: [{ by: 'price' }], 'item.on': T }]),
    // "Its members are blend, method, k and direction; any other is refused"
    code: 'unknown-key',
  },
  {
    name: 'a facet with ranges and an interval',
    query: top({
      facets: [{ by: 'price', ranges: [{ to: 10 }], interval: 'month' }],
    }),
    code: 'conflicting-members',
  },
  {
    name: 'a facet with a measure and ranges',
    query: top({
      facets: [
        { by: 'price', measure: { avg: 'price' }, ranges: [{ to: 10 }] },
      ],
    }),
    code: 'conflicting-members',
  },
  {
    name: 'a facet with a measure and an interval',
    query: top({
      facets: [{ by: 'kind', measure: { avg: 'price' }, interval: 'month' }],
    }),
    code: 'conflicting-members',
  },
  {
    name: 'a facet range from a number to a word',
    query: top({ facets: [{ by: 'price', ranges: [{ from: 1, to: 'z' }] }] }),
    code: 'conflicting-members',
  },
  {
    name: 'a comparison by a field and by look-alikes at once',
    query: s([
      { expression: 'price', compare: { near: 'embedding', by: 'kind' } },
    ]),
    code: 'conflicting-members',
  },
  {
    name: 'a binding that is one card and a list',
    query: top({ let: { $a: { ...binding, one: true } } }),
    code: 'invalid-value',
  },
  {
    name: 'sparse fields without asData',
    query: { filter: { on: T, eq: { kind: 'lamp' } }, fields: {} },
    wire: false,
    code: 'conflicting-members',
  },
];

// ---- out of range, over a limit, in the wrong place -----------------------

const many = <V>(n: number, make: (i: number) => V): V[] =>
  Array.from({ length: n }, (_, i) => make(i));

const LIMITS: Mistake[] = [
  {
    name: 'nine signals in a blend',
    query: s([{ blend: many(9, (i) => ({ by: `f${i}` })) }]),
    code: 'limit-exceeded',
  },
  {
    name: 'nine signals in a blend, eight of them boosts',
    query: s([
      {
        blend: [
          { by: 'price' },
          ...many(8, (i) => ({ boost: { eq: { kind: `k${i}` } } })),
        ],
      },
    ]),
    code: 'limit-exceeded',
  },
  {
    name: 'a blend inside a blend',
    query: s([{ blend: [{ blend: [{ by: 'price' }] }] }]),
    code: 'invalid-nesting',
  },
  {
    name: 'a relevance sort inside a blend',
    query: s([{ blend: [{ relevance: true }] }], {
      filter: { matches: 'lamp' },
    }),
    code: 'invalid-nesting',
  },
  {
    name: 'a boost outside a blend',
    query: s([{ boost: { eq: { kind: 'lamp' } }, weight: 2 }]),
    code: 'invalid-nesting',
  },
  {
    name: 'nine facets',
    query: top({ facets: many(9, (i) => ({ by: `f${i}` })) }),
    code: 'limit-exceeded',
  },
  {
    name: 'fifty-one ranges in a facet',
    query: top({
      facets: [{ by: 'price', ranges: many(51, (i) => ({ to: i + 1 })) }],
    }),
    code: 'limit-exceeded',
  },
  {
    name: 'nine fields beside matches',
    query: f({ matches: 'lamp', fields: many(9, (i) => `f${i}`) }),
    code: 'limit-exceeded',
  },
  {
    name: 'five bindings',
    query: top({
      let: Object.fromEntries(many(5, (i) => [`$b${i}`, binding])),
    }),
    code: 'limit-exceeded',
  },
  ...[0, -1, 10_001, 100_000].map((size) => ({
    name: `a binding's page of ${size}`,
    query: top({
      let: {
        $a: { from: { ...binding.from, page: { size } }, select: 'kind' },
      },
      filter: usingA,
    }),
    code: 'invalid-value',
  })),
  {
    name: "a binding's page with a number",
    query: top({
      let: {
        $a: {
          from: { ...binding.from, page: { size: 10, number: 1 } },
          select: 'kind',
        },
      },
      filter: usingA,
    }),
    code: 'invalid-value',
  },
  {
    name: "a binding whose query reads another binding's list",
    query: top({
      let: {
        $a: binding,
        $b: { from: { type: T, filter: usingA }, select: 'kind' },
      },
      filter: { in: { kind: '$b' } },
    }),
    code: 'invalid-nesting',
  },
  {
    name: "a binding whose query reads another binding's card",
    query: top({
      let: {
        $a: { from: { type: T, filter: kind }, one: true },
        $b: {
          from: {
            type: T,
            filter: { eq: { kind: '$a.kind' } },
          },
          select: 'kind',
        },
      },
      filter: { in: { kind: '$b' } },
    }),
    code: 'invalid-nesting',
  },
  {
    name: 'a near target of 2,001 components',
    query: s([{ by: 'embedding', near: many(2001, () => 0.1) }]),
    code: 'limit-exceeded',
  },
];

// ---- an unknown member, at every level ------------------------------------

// `newer` is refused (`unknown-key`), and its message names `nearest`, the
// real member the unknown one is closest to. `older` is the same unknown
// member in a query with `on` anchors and no newer spelling, and `olderIs`
// is what the docs say of it:
//   ignored  a filter, a field sort and a page could be saved before the
//            newer spellings existed, and "a query written before the newer
//            spellings is read as it always was … a member the grammar never
//            read is still ignored";
//   refused  the top level always refused an unknown member, so reading it
//            "as it always was" refuses it; and facets, collapse, rerank,
//            let and near sorts arrived with the strict grammar, so no saved
//            query ever had a member ignored there (of a near sort the docs
//            say so outright: "and so is a member a near sort entry does not
//            have").
interface UnknownMember {
  level: string;
  newer: Q;
  unknown: string;
  nearest: string;
  older?: Q;
  olderIs?: 'ignored' | 'refused';
  wire?: unknown;
}

const on = T;
const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: 'the top level',
    newer: top({ fliter: kind }),
    unknown: 'fliter',
    nearest: 'filter',
    older: { filter: { on, ...kind }, fliter: kind },
    olderIs: 'refused',
  },
  {
    level: 'the top level, beside a filter',
    newer: f(kind, { srot: [{ by: 'price' }] }),
    unknown: 'srot',
    nearest: 'sort',
    older: { filter: { on, ...kind }, srot: [] },
    olderIs: 'refused',
  },
  {
    level: 'a filter',
    newer: f({ ...kind, prefx: true }),
    unknown: 'prefx',
    nearest: 'prefix',
    older: { filter: { on, ...kind, prefx: true } },
    olderIs: 'ignored',
  },
  {
    level: 'a filter inside every',
    newer: f({ every: [kind, { range: { price: { gt: 1 } }, rnage: 1 }] }),
    unknown: 'rnage',
    nearest: 'range',
    older: {
      filter: {
        on,
        every: [
          { on, ...kind },
          { on, range: { price: { gt: 1 } }, rnage: 1 },
        ],
      },
    },
    olderIs: 'ignored',
  },
  {
    level: 'a filter inside any',
    newer: f({ any: [kind, { matches: 'lamp', typoes: true }] }),
    unknown: 'typoes',
    nearest: 'typos',
    older: {
      filter: {
        any: [
          { on, ...kind },
          { on, matches: 'lamp', typoes: true },
        ],
      },
    },
    olderIs: 'ignored',
  },
  {
    level: 'a filter inside not',
    newer: f({ not: { ...kind, scpe: 'title' } }),
    unknown: 'scpe',
    nearest: 'scope',
    older: { filter: { on, not: { ...kind, scpe: 'title' } } },
    olderIs: 'ignored',
  },
  {
    level: 'a field sort entry',
    newer: s([{ by: 'price', directon: 'asc' }]),
    unknown: 'directon',
    nearest: 'direction',
    older: { sort: [{ on, by: 'price', directon: 'asc' }] },
    olderIs: 'ignored',
  },
  {
    level: 'a general sort entry',
    newer: s([{ by: 'lastModified', misssing: 'first' }]),
    unknown: 'misssing',
    nearest: 'missing',
    older: { sort: [{ by: 'lastModified', misssing: 'first' }] },
    olderIs: 'ignored',
  },
  {
    level: 'a text-relevance sort entry',
    newer: f(
      { matches: 'lamp' },
      { sort: [{ by: 'textRelevance', wieght: 2 }] },
    ),
    unknown: 'wieght',
    nearest: 'weight',
    older: {
      filter: { on, matches: 'lamp' },
      sort: [{ by: '_matchRelevance', wieght: 2 }],
    },
    olderIs: 'ignored',
  },
  {
    level: 'a near sort entry',
    newer: s([{ by: 'embedding', near: [1, 0], directon: 'asc' }]),
    unknown: 'directon',
    nearest: 'direction',
    older: { sort: [{ on, by: 'embedding', near: [1, 0], directon: 'asc' }] },
    olderIs: 'refused',
  },
  {
    level: 'a blend',
    newer: s([{ blend: [{ by: 'price' }], fusion: 'rrf' }]),
    unknown: 'fusion',
    nearest: 'method',
  },
  {
    level: 'a blend, a near miss',
    newer: s([{ blend: [{ by: 'price' }], methd: 'rrf' }]),
    unknown: 'methd',
    nearest: 'method',
  },
  {
    level: 'a signal inside a blend',
    newer: s([{ blend: [{ by: 'price', wieght: 2 }] }]),
    unknown: 'wieght',
    nearest: 'weight',
  },
  {
    level: 'a near signal inside a blend',
    newer: s([{ blend: [{ by: 'embedding', near: [1, 0], wieght: 2 }] }]),
    unknown: 'wieght',
    nearest: 'weight',
  },
  {
    level: 'a boost',
    newer: s([{ blend: [{ boost: kind, wieght: 2 }] }]),
    unknown: 'wieght',
    nearest: 'weight',
  },
  {
    level: "a boost's filter",
    newer: s([{ blend: [{ boost: { ...kind, prefx: true }, weight: 2 }] }]),
    unknown: 'prefx',
    nearest: 'prefix',
  },
  {
    level: 'a relevance sort',
    newer: f(
      { matches: 'lamp' },
      { sort: [{ relevance: true, directon: 'asc' }] },
    ),
    unknown: 'directon',
    nearest: 'direction',
  },
  {
    level: 'a facet',
    newer: top({ facets: [{ by: 'kind', sizee: 5 }] }),
    unknown: 'sizee',
    nearest: 'size',
    older: { filter: { on, ...kind }, facets: [{ by: 'kind', sizee: 5 }] },
    olderIs: 'refused',
  },
  {
    level: "a facet's range",
    newer: top({ facets: [{ by: 'price', ranges: [{ form: 1, to: 5 }] }] }),
    unknown: 'form',
    nearest: 'from',
    older: {
      filter: { on, ...kind },
      facets: [{ by: 'price', ranges: [{ form: 1, to: 5 }] }],
    },
    olderIs: 'refused',
  },
  {
    level: 'the page',
    newer: top({ page: { size: 10, numbr: 1 } }),
    unknown: 'numbr',
    nearest: 'number',
    older: { filter: { on, ...kind }, page: { size: 10, numbr: 1 } },
    olderIs: 'ignored',
  },
  {
    level: 'a collapse',
    newer: top({ collapse: { by: 'kind', kep: 2 } }),
    unknown: 'kep',
    nearest: 'keep',
    older: { filter: { on, ...kind }, collapse: { by: 'kind', on, kep: 2 } },
    olderIs: 'refused',
  },
  {
    level: 'a window',
    newer: s([{ expression: 'price', top: 5, topp: 5 }]),
    unknown: 'topp',
    nearest: 'top',
  },
  {
    level: "a window's comparison",
    newer: s([{ expression: 'price', compare: { bye: 'kind' } }]),
    unknown: 'bye',
    nearest: 'by',
  },
  {
    level: 'a let binding',
    newer: top({ let: { $a: { ...binding, onee: true } }, filter: usingA }),
    unknown: 'onee',
    nearest: 'one',
    older: {
      let: {
        $a: {
          from: { filter: { on, ...kind } },
          select: 'kind',
          onee: true,
        },
      },
      filter: { on, in: { kind: '$a' } },
    },
    olderIs: 'refused',
  },
  {
    level: "a let binding's query",
    newer: top({
      let: { $a: { from: { ...binding.from, sorrt: [] }, select: 'kind' } },
      filter: usingA,
    }),
    unknown: 'sorrt',
    nearest: 'sort',
  },
  {
    level: "a near filter's value",
    newer: f({ near: { embedding: { to: [1, 0], minSimilarty: 0.5 } } }),
    unknown: 'minSimilarty',
    nearest: 'minSimilarity',
  },
  {
    level: "a range's bounds",
    newer: f({ range: { price: { gte: 1, lessThan: 5 } } }),
    unknown: 'lessThan',
    nearest: 'lt',
    older: { filter: { on, range: { price: { gte: 1, lessThan: 5 } } } },
    // a bound that is not a bound was refused before the newer spellings
    olderIs: 'refused',
  },
];

// ---- accepted --------------------------------------------------------------

// The other side of each limit, and values that look wrong and are not.
const ACCEPTED: [string, Q][] = [
  [
    'eight signals in a blend',
    s([{ blend: many(8, (i) => ({ by: `f${i}` })) }]),
  ],
  [
    'a negative weight in a blend (it inverts the signal)',
    s([{ blend: [{ by: 'price', weight: -1 }] }]),
  ],
  [
    'a negative and a zero weight in a relevance sort',
    f(
      { matches: 'lamp' },
      { sort: [{ relevance: { text: -1, popularity: 0 } }] },
    ),
  ],
  ['eight facets', top({ facets: many(8, (i) => ({ by: `f${i}` })) })],
  ['a facet of 1,000 values', top({ facets: [{ by: 'kind', size: 1000 }] })],
  [
    'fifty ranges in a facet',
    top({
      facets: [{ by: 'price', ranges: many(50, (i) => ({ to: i + 1 })) }],
    }),
  ],
  [
    'eight fields beside matches',
    f({ matches: 'lamp', fields: many(8, (i) => `f${i}`) }),
  ],
  [
    'four bindings',
    top({ let: Object.fromEntries(many(4, (i) => [`$b${i}`, binding])) }),
  ],
  [
    "a binding's page of 1,000",
    top({
      let: {
        $a: { from: { ...binding.from, page: { size: 1000 } }, select: 'kind' },
      },
      filter: usingA,
    }),
  ],
  ['a collapse keeping ten', top({ collapse: { by: 'kind', keep: 10 } })],
  ['a window of the top 500', s([{ expression: 'price', top: 500 }])],
  ['a page of no rows', top({ page: { size: 0 } })],
  [
    'a similarity floor of -1',
    f({ near: { embedding: { to: [1, 0], minSimilarity: -1 } } }),
  ],
  [
    'a near target of 2,000 components',
    s([{ by: 'embedding', near: many(2000, () => 0.1) }]),
  ],
  [
    'a text value that starts with a dollar sign',
    f({ eq: { kind: '$25 gift' } }),
  ],
  ['an empty in list', f({ in: { kind: [] } })],
  [
    'an in list of 2,000 values',
    f({ in: { kind: many(2000, (i) => `k${i}`) } }),
  ],
  [
    'an any of 2,000 filters',
    f({ any: many(2000, (i) => ({ eq: { kind: `k${i}` } })) }),
  ],
  [
    'an every of 2,000 filters',
    f({ every: many(2000, (i) => ({ range: { price: { gt: i } } })) }),
  ],
  ['a null eq value', f({ eq: { kind: null } })],
  ['a term of punctuation', f({ matches: `'; DROP TABLE boxel_index; --` })],
];

// ---- names chosen to break a lookup ---------------------------------------

// Names every JavaScript object answers to, which a field lookup written as
// a plain property read would find.
const INHERITED_NAMES = [
  'constructor',
  '__proto__',
  'toString',
  'hasOwnProperty',
];
// Paths that are not field paths: an empty segment, an index, brackets, a
// quote of each kind, a statement separator, a null byte, a space, nothing.
const MALFORMED_PATHS = [
  'a..b',
  '.a',
  'a.',
  'a[0]',
  'a[]',
  "a'b",
  'a"b',
  'a;b',
  'a\u0000b',
  'a b',
  'a-b',
  '',
  "kind'; DROP TABLE boxel_index; --",
];

// With a key that is the literal text `__proto__`, as JSON gives it.
const keyed = (key: string, value: unknown): Q =>
  JSON.parse(`{${JSON.stringify(key)}:${JSON.stringify(value)}}`);

// 200 filters, each inside the last.
function nested(depth: number, wrap: (inner: Q) => Q): Q {
  let node: Q = { eq: { kind: 'lamp' } };
  for (let i = 0; i < depth; i++) {
    node = wrap(node);
  }
  return node;
}

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    function table(group: string, mistakes: Mistake[]) {
      for (let { name, query, code, wire } of mistakes) {
        test(`[validation] ${group}: ${name} is ${code}`, function (assert) {
          isRefusedWith(assert, viaAssert(query), code, 'assertQuery');
          if (wire !== false) {
            isRefusedWith(assert, viaWire(wire ?? query), code, 'the wire');
          }
        });
      }
    }

    table('a code no test asserted', UNASSERTED_CODES);
    table('a wrong kind of value', WRONG_KIND);
    table('members that cannot go together', CONFLICTS);
    table('out of range or over a limit', LIMITS);

    for (let row of UNKNOWN_MEMBERS) {
      test(`[validation] an unknown member of ${row.level} ("${row.unknown}") is unknown-key, naming "${row.nearest}"`, function (assert) {
        assert.true(
          usesNewSyntax(row.newer),
          'the query is in a newer spelling',
        );
        for (let [door, got] of [
          ['assertQuery', viaAssert(row.newer)],
          ['the wire', viaWire(row.wire ?? row.newer)],
        ] as [string, Outcome][]) {
          isRefusedWith(assert, got, 'unknown-key', door);
          assert.true(
            got.message.includes(row.unknown),
            `${door}: the message names the unknown member (${got.message.slice(0, 160)})`,
          );
          assert.true(
            new RegExp(`\\b${row.nearest}\\b`).test(got.message),
            `${door}: the message names the nearest real member, "${row.nearest}" (${got.message.slice(0, 160)})`,
          );
        }
      });
      if (row.older) {
        let older = row.older;
        // A member main's grammar never had (`facets`, `collapse`, `let`,
        // …) makes the whole query the newer spelling (ADR 022 §1.7), so
        // its `on` anchors no longer make it older.
        let v2 = ['facets', 'collapse', 'let', 'explain', 'timeZone'].some(
          (k) => k in older,
        );
        test(`[validation] the same unknown member of ${row.level} ${v2 ? 'beside on anchors is still the newer spelling, and' : 'in the older spelling is'} ${row.olderIs}`, function (assert) {
          assert.strictEqual(
            usesNewSyntax(older),
            v2,
            v2
              ? 'a V2 member makes the query the newer spelling'
              : 'the query is in the older spelling',
          );
          let got = viaAssert(older);
          if (row.olderIs === 'ignored') {
            assert.strictEqual(
              got.kind,
              'accepted',
              `read as it always was (${got.message.slice(0, 160)})`,
            );
          } else {
            isRefusedWith(assert, got, 'unknown-key', 'assertQuery');
          }
        });
      }
    }

    test('[validation] an unknown member of a saved page is still ignored over the wire', function (assert) {
      // The docs' own example: `page.cursor`, in a query with no newer
      // spelling, as a request carries it.
      let got = viaWire({
        filter: { 'item.on': T, eq: { 'item.kind': 'lamp' } },
        page: { size: 10, cursor: 'abc' },
      });
      assert.strictEqual(got.kind, 'accepted', got.message);
    });

    for (let [name, query] of ACCEPTED) {
      test(`[validation] accepted: ${name}`, function (assert) {
        let asserted = viaAssert(query);
        assert.strictEqual(asserted.kind, 'accepted', asserted.message);
        let wired = viaWire(query);
        assert.strictEqual(wired.kind, 'accepted', wired.message);
      });
    }

    // select exists only on the wire: it answers a table, which a card's own
    // search has no use for.
    const selecting = (select: unknown, more: Q = {}) =>
      viaWire({ type: T, select, ...more });

    test('[validation] select: a wrong kind of value is invalid-value', function (assert) {
      for (let select of [
        'kind',
        3,
        null,
        {},
        [],
        [3],
        [null],
        [['kind']],
        [{}],
        [{ a: 'kind', b: 'price' }],
        [{ label: 3 }],
        [{ label: null }],
      ]) {
        isRefusedWith(
          assert,
          selecting(select),
          'invalid-value',
          `select: ${JSON.stringify(select)}`,
        );
      }
    });

    test('[validation] select: limits and clashes', function (assert) {
      isRefusedWith(
        assert,
        selecting(many(65, (i) => `f${i}`)),
        'limit-exceeded',
        '65 columns',
      );
      assert.strictEqual(
        selecting(many(64, (i) => `f${i}`)).kind,
        'accepted',
        '64 columns',
      );
      isRefusedWith(
        assert,
        selecting(['kind', 'kind']),
        'conflicting-members',
        'one name twice',
      );
      isRefusedWith(
        assert,
        selecting(['kind', { kind: 'price' }]),
        'conflicting-members',
        'a renamed column taking another column’s name',
      );
      isRefusedWith(
        assert,
        selecting(['id']),
        'conflicting-members',
        'a column named id, which every row starts with',
      );
      isRefusedWith(
        assert,
        selecting(['kind'], { fields: { entry: ['item'] } }),
        'select-excludes-fields',
        'select beside fields',
      );
    });

    test('[validation] a card search has no select', function (assert) {
      // pins current behavior; rule not yet decided: the docs list `select`
      // among a query's members, and say it "answers a query as a table".
      // `assertQuery`, which checks a card's own search, has no such member.
      isRefusedWith(
        assert,
        viaAssert({ type: T, select: ['kind'] }),
        'unknown-key',
        'assertQuery',
      );
    });

    test('[validation] a path that is not a field path is invalid-value wherever a path is checked', function (assert) {
      // A facet's `by`, a collapse's `by`, a binding's `select`, the fields
      // beside `matches`, a comparison's `by`, a `linkedFrom` field and a
      // select column are each checked as a path when the query is read.
      for (let path of MALFORMED_PATHS) {
        let shown = JSON.stringify(path);
        let places: [string, Q, boolean][] = [
          ['facet by', top({ facets: [{ by: path }] }), true],
          ['collapse by', top({ collapse: { by: path } }), true],
          ['a bare collapse', top({ collapse: path }), path !== ''],
          [
            "a binding's select",
            top({ let: { $a: { ...binding, select: path } }, filter: usingA }),
            true,
          ],
          ['matches fields', f({ matches: 'lamp', fields: [path] }), true],
          [
            "a comparison's by",
            s([{ expression: 'price', compare: { by: path } }]),
            path !== '',
          ],
          [
            "a facet measure's field",
            top({ facets: [{ by: 'kind', measure: { avg: path } }] }),
            true,
          ],
          [
            'linkedFrom field',
            f({ linkedFrom: { card: 'http://a.test/W/1', field: path } }),
            true,
          ],
        ];
        for (let [place, query, checked] of places) {
          if (!checked) continue;
          isRefusedWith(
            assert,
            viaAssert(query),
            'invalid-value',
            `${place} ${shown}, assertQuery`,
          );
          isRefusedWith(
            assert,
            viaWire(query),
            'invalid-value',
            `${place} ${shown}, the wire`,
          );
        }
        isRefusedWith(
          assert,
          selecting([path]),
          'invalid-value',
          `select ${shown}`,
        );
        isRefusedWith(
          assert,
          selecting([{ label: path }]),
          'invalid-value',
          `select, renamed, ${shown}`,
        );
      }
    });

    test('[validation] a field name wrapped in brackets is invalid-value in a filter', function (assert) {
      for (let op of ['eq', 'in', 'contains', 'pattern', 'regex']) {
        let value = op === 'in' ? ['x'] : 'x';
        isRefusedWith(
          assert,
          viaAssert(f({ [op]: { '[kind]': value } })),
          'invalid-value',
          `${op}, assertQuery`,
        );
        isRefusedWith(
          assert,
          viaWire(f({ [op]: { '[kind]': value } })),
          'invalid-value',
          `${op}, the wire`,
        );
      }
    });

    test("[validation] a filter or a sort on a name every object has is not refused here; the type's fields decide when it runs", function (assert) {
      // A filter's field and a sort's `by` are checked against the type,
      // which needs the index (see the [run] tests below). Reading the query
      // must not trip on them either.
      for (let name of [...INHERITED_NAMES, ...MALFORMED_PATHS]) {
        for (let [place, query] of [
          ['eq', f({ eq: keyed(name, 'x') })],
          ['range', f({ range: keyed(name, { gt: 1 }) })],
          ['sort', s([{ by: name }])],
        ] as [string, Q][]) {
          let got = viaAssert(query);
          let readOrRefused = got.kind === 'accepted' || got.refused;
          assert.true(
            readOrRefused,
            `${place} ${JSON.stringify(name)}: read or refused, never a crash (${got.kind}: ${got.message.slice(0, 120)})`,
          );
        }
      }
    });

    test('[validation] an inherited name as a binding name', function (assert) {
      for (let name of INHERITED_NAMES) {
        // A string naming no declared binding is text: the lookup must not
        // find the name on the object every object inherits from, so the
        // query is checked as an `in` of that one literal value.
        let got = viaAssert(
          top({
            let: { $a: binding },
            filter: {
              every: [{ in: { kind: '$a' } }, { in: { kind: [`$${name}`] } }],
            },
          }),
        );
        assert.false(
          got.refused,
          `"$${name}" is text (${got.message.slice(0, 140)})`,
        );
      }
    });

    // ---- not a query at all ------------------------------------------------

    test('[validation] a query that is not an object is refused', function (assert) {
      for (let input of ['kind = lamp', 3, null, undefined, true]) {
        isRefusedWith(
          assert,
          viaAssert(input),
          'missing-member',
          `assertQuery(${JSON.stringify(input)})`,
        );
      }
      for (let input of [[], [[]], [[[[]]]], [{ filter: {} }]]) {
        let got = viaAssert(input);
        assert.true(
          got.refused,
          `assertQuery(${JSON.stringify(input)}): a list is no query (was: ${got.kind})`,
        );
        assert.strictEqual(
          typeof got.code,
          'string',
          `assertQuery(${JSON.stringify(input)}): with a code`,
        );
      }
    });

    test('[validation] a request body that is not an object is refused with a code', function (assert) {
      for (let input of ['kind = lamp', 3, null, true, [], [[[[]]]], [{}]]) {
        let got = viaWire(input);
        assert.true(
          got.refused,
          `${JSON.stringify(input)}: refused (was: ${got.kind})`,
        );
        assert.strictEqual(
          typeof got.code,
          'string',
          `${JSON.stringify(input)}: with a code (${got.message})`,
        );
      }
    });

    test('[validation] a filter nested 200 deep is read without a crash', function (assert) {
      // pins current behavior; rule not yet decided: the docs give no depth
      // limit, and a filter 200 levels deep is accepted.
      for (let [shape, wrap] of [
        ['not', (inner: Q) => ({ not: inner })],
        ['every', (inner: Q) => ({ every: [inner] })],
        ['any', (inner: Q) => ({ any: [inner, { eq: { kind: 'x' } }] })],
      ] as [string, (inner: Q) => Q][]) {
        let query = f(nested(200, wrap));
        let asserted = viaAssert(query);
        assert.strictEqual(
          asserted.kind,
          'accepted',
          `${shape}, assertQuery: ${asserted.message.slice(0, 120)}`,
        );
        let wired = viaWire(query);
        assert.strictEqual(
          wired.kind,
          'accepted',
          `${shape}, the wire: ${wired.message.slice(0, 120)}`,
        );
      }
    });

    test('[validation] a filter nested 20,000 deep is refused, not a stack overflow', function (assert) {
      // Deep enough to exhaust the stack of a reader that recurses. A
      // caller must get a refusal with a code, never a RangeError.
      for (let [shape, wrap] of [
        ['not', (inner: Q) => ({ not: inner })],
        ['every', (inner: Q) => ({ every: [inner] })],
      ] as [string, (inner: Q) => Q][]) {
        let query = f(nested(20_000, wrap));
        let got = viaAssert(query);
        assert.true(
          got.refused,
          `${shape}: refused as a query (was: ${got.kind}, ${got.message.slice(0, 80)})`,
        );
        assert.strictEqual(typeof got.code, 'string', `${shape}: with a code`);
      }
    });

    test('[validation] a card search over the page limit is refused with a code; a request is clamped', function (assert) {
      // "A card search that names none gets the first 100, which is also
      // the most a card search may ask for."
      let query = { filter: { type: T }, page: { size: 101 } } as Query;
      let error: unknown;
      try {
        applySearchPageBound(query);
      } catch (e) {
        error = e;
      }
      assert.ok(error, 'a page of 101 is refused');
      assert.strictEqual(
        typeof (error as { code?: unknown } | undefined)?.code,
        'string',
        `the refusal has a code (${String((error as Error | undefined)?.message).slice(0, 100)})`,
      );
      assert.strictEqual(
        applySearchPageBound({
          filter: { type: T },
          page: { size: 100 },
        } as Query).page?.size,
        100,
        'a page of 100 is as asked',
      );
      // "A `_search` … request that names a size takes up to 2,000, clamped
      // above that."
      assert.strictEqual(
        applyServerSearchPageBound({
          filter: { type: T },
          page: { size: 1_000_000 },
        } as Query).page?.size,
        2000,
        'a request for a million rows gets 2,000',
      );
    });
  });

  // ---- refused only when the query runs -----------------------------------

  module('refused when run (Postgres)', function (hooks) {
    const stringRef = ref('@cardstack/base/string', 'default');
    const numberRef = ref('@cardstack/base/number', 'default');
    const vectorRef = ref('@cardstack/base/vector', 'default');
    // Every text and number field here is a facet: these cases test what
    // is refused when a query runs, not which fields declare one.
    const text = (search?: Q) => ({
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { ...(search ?? {}), facet: true },
    });
    const listingDef = {
      type: 'card-def',
      codeRef: T,
      displayName: 'Listing',
      fields: {
        title: 'title',
        kind: 'kind',
        memo: 'memo',
        sku: 'sku',
        price: 'price',
        embedding: 'embedding',
      },
      fieldDefs: {
        title: text({ role: 'title' }),
        kind: text(),
        // plain text: not searched by pattern
        memo: text(),
        sku: text({ role: 'identifier', patterns: true }),
        price: {
          type: 'contains',
          isPrimitive: true,
          isComputed: false,
          fieldOrCard: numberRef,
          serializerName: 'number',
          search: { facet: true },
        },
        // a vector with no neighbor index declared
        embedding: {
          type: 'contains',
          isPrimitive: true,
          isComputed: false,
          fieldOrCard: vectorRef,
          serializerName: 'vector',
        },
      },
    } as unknown as Definition;
    // a type with no vector field at all
    const noteDef = {
      type: 'card-def',
      codeRef: noteRef,
      displayName: 'Note',
      fields: { title: 'title' },
      fieldDefs: { title: text({ role: 'title' }) },
    } as unknown as Definition;
    const cardDef = {
      type: 'card-def',
      codeRef: baseCardRef,
      displayName: 'Card',
      fields: {},
      fieldDefs: {},
    } as unknown as Definition;

    function makeDefinitionLookup(): DefinitionLookup {
      const lookup = {
        async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
          let found = [listingDef, noteDef, cardDef].find((d) => {
            let r = d.codeRef as ResolvedCodeRef;
            return r.module === codeRef.module && r.name === codeRef.name;
          });
          if (!found) {
            throw new Error(
              `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
            );
          }
          return found;
        },
        async lookupDefinitionEntry(): Promise<never> {
          throw new Error('lookupDefinitionEntry is not used by these tests');
        },
        async lookupCachedDefinition() {
          return undefined;
        },
        async invalidate() {
          return [];
        },
        async clearRealmDefinitions() {},
        async clearAllDefinitions() {},
        registerRealm() {},
        async getCachedDefinitions() {
          return undefined;
        },
        async populateDefinitionCacheEntry() {
          return undefined;
        },
        async getCachedDefinitionsBatch() {
          return {};
        },
        forRealm() {
          return lookup;
        },
      } as unknown as DefinitionLookup;
      return lookup;
    }

    const vec = (components: number[]) =>
      VectorSerializer.queryableValue(
        VectorSerializer.encodeVector(components),
      );

    const ROWS: Record<string, Q> = {
      one: {
        title: 'Brass lamp',
        kind: 'lamp',
        memo: 'LMP-1 on the shelf',
        sku: 'LMP-1',
        price: 60,
        embedding: vec([1, 0, 0]),
      },
      two: {
        title: 'Glass lamp',
        kind: 'lamp',
        memo: 'plain',
        sku: 'LMP-2',
        price: 40,
        embedding: vec([1, 1, 0]),
      },
      three: {
        title: 'Oak bench',
        kind: 'bench',
        memo: 'plain',
        sku: 'BNC-1',
        price: 120,
        embedding: vec([0, 1, 0]),
      },
      four: {
        title: 'Teak bench',
        kind: 'bench',
        memo: 'plain',
        sku: 'BNC-2',
        price: 150,
        embedding: vec([0, 0, 1]),
      },
    };

    let adapter: PgAdapter;
    let engine: IndexQueryEngine;
    let vn: VirtualNetwork;
    const realmURL = new URL(realm);

    setupDB(hooks, {
      before: async (dbAdapter) => {
        adapter = dbAdapter;
        vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        let batch = await new IndexWriter(dbAdapter).createBatch(
          realmURL,
          vn,
          undefined,
          { splitPrerenderHtml: false },
        );
        for (let [name, row] of Object.entries(ROWS)) {
          let cardURL = new URL(`${realm}Listing/${name}.json`);
          await batch.updateEntry(cardURL, {
            type: 'instance',
            resource: {
              id: rri(cardURL.href),
              type: 'card',
              attributes: {},
              meta: { adoptsFrom: { module: rri(T.module), name: T.name } },
            },
            lastModified: Date.now(),
            resourceCreatedAt: Date.now(),
            searchData: {
              ...row,
              [SEARCH_TEXT_KEY]: {
                A: row.title,
                patterns: row.sku,
                facets: await facetFieldSpecsOf(
                  listingDef,
                  async () => undefined,
                ),
              },
              _typeahead: row.title,
            },
            markdown: `# ${row.title}`,
            deps: new Set(),
            displayNames: ['Listing'],
            types: [internalKeyFor(T, undefined, vn)],
            isolatedHtml: `<div>${name}</div>`,
          });
        }
        await batch.done();
      },
    });

    hooks.afterEach(function () {
      setVectorSearchSettings();
    });

    async function run(
      query: Q,
      using: IndexQueryEngine = engine,
    ): Promise<Outcome & { names?: string[]; meta?: any }> {
      try {
        // the engine's own search takes the lowered form of a newer spelling
        let asked = usesNewSyntax(query) ? lowerQuery(query).query : query;
        let { cards, meta } = await using.searchCards(realmURL, asked as Query);
        return {
          refused: false,
          kind: 'ran',
          code: undefined,
          message: '',
          names: cards
            .map((c) =>
              String(c.id)
                .split('/')
                .pop()!
                .replace(/\.json$/, ''),
            )
            .sort(),
          meta,
        };
      } catch (e) {
        return describeError(e);
      }
    }

    // Every statement the index is sent while `fn` runs.
    async function statements(fn: () => Promise<unknown>): Promise<string[]> {
      let seen: string[] = [];
      let real = adapter.execute;
      (adapter as any).execute = function (sql: string, ...rest: unknown[]) {
        seen.push(sql);
        return (real as any).call(adapter, sql, ...rest);
      };
      try {
        await fn();
      } finally {
        (adapter as any).execute = real;
      }
      return seen;
    }

    test('the fixture is in the index', async function (assert) {
      let all = await run({ filter: { type: T } });
      assert.deepEqual(all.names, ['four', 'one', 'three', 'two'], all.message);
    });

    test('[run] a pattern or a regex on a field not searched by pattern is needs-declaration', async function (assert) {
      for (let query of [
        { filter: { on: T, pattern: { memo: 'LMP-*' } } },
        { filter: { on: T, regex: { memo: '^LMP' } } },
        { filter: { on: T, pattern: { title: 'Brass*' } } },
        { filter: { on: T, not: { regex: { kind: '^lamp$' } } } },
        {
          filter: {
            on: T,
            every: [
              { on: T, eq: { kind: 'lamp' } },
              { any: [{ on: T, pattern: { memo: '*' } }] },
            ],
          },
        },
      ]) {
        isRefusedWith(
          assert,
          await run(query),
          'needs-declaration',
          JSON.stringify(query.filter).slice(0, 80),
        );
      }
      // the declared field beside it runs
      assert.deepEqual(
        (await run({ filter: { on: T, pattern: { sku: 'lmp-*' } } })).names,
        ['one', 'two'],
      );
    });

    test('[run] a near filter or sort on a field that is not a vector is needs-declaration', async function (assert) {
      isRefusedWith(
        assert,
        await run({
          filter: { on: T, near: { kind: { to: [1, 0, 0] } } },
        }),
        'needs-declaration',
        'a near filter on a text field',
      );
      isRefusedWith(
        assert,
        await run({ sort: [{ on: T, by: 'price', near: [1, 0, 0] }] }),
        'needs-declaration',
        'a near sort on a number field',
      );
      isRefusedWith(
        assert,
        await run({
          filter: { type: T },
          sort: [
            {
              by: '_blend',
              of: [{ on: T, by: 'title', near: [1, 0, 0] }],
            } as any,
          ],
        }),
        'needs-declaration',
        'a near signal in a blend on a text field',
      );
    });

    test('[run] a relevance sort near a vector, on a type with no vector field, is needs-declaration', async function (assert) {
      isRefusedWith(
        assert,
        await run({
          type: noteRef,
          filter: { matches: 'lamp' },
          sort: [{ relevance: true, near: [1, 0, 0] }],
        }),
        'needs-declaration',
        'the newer spelling',
      );
    });

    test('[run] look-alikes by a vector field with no neighbor index declared is needs-declaration', async function (assert) {
      isRefusedWith(
        assert,
        await run({
          type: T,
          sort: [
            {
              expression: 'COUNT(peers.price)',
              compare: { near: 'embedding', k: 2 },
            },
          ],
        }),
        'needs-declaration',
        'compare.near',
      );
    });

    test('[run] a relevance sort near a vector with no type anywhere is needs-type', async function (assert) {
      isRefusedWith(
        assert,
        await run({
          filter: { matches: 'lamp' },
          sort: [{ relevance: true, near: [1, 0, 0] }],
        }),
        'needs-type',
        'no type, no anchor',
      );
    });

    test('[run] a collapse with no type anywhere is needs-type', async function (assert) {
      isRefusedWith(
        assert,
        await run({ collapse: 'kind' }),
        'needs-type',
        'a bare path',
      );
      isRefusedWith(
        assert,
        await run({ filter: { matches: 'lamp' }, collapse: { by: 'kind' } }),
        'needs-type',
        'beside an unanchored filter',
      );
      let anchored = await run({ filter: { type: T }, collapse: 'kind' });
      assert.strictEqual(
        anchored.names?.length,
        2,
        `with the filter's anchor it runs: one per kind (${anchored.message})`,
      );
    });

    test('[run] a field the type does not have is unknown-field, with the nearest field', async function (assert) {
      for (let [place, query] of [
        ['eq', { filter: { on: T, eq: { knd: 'lamp' } } }],
        ['range', { filter: { on: T, range: { prise: { gt: 1 } } } }],
        ['in', { filter: { on: T, in: { knd: ['lamp'] } } }],
        ['contains', { filter: { on: T, contains: { titel: 'la' } } }],
        ['pattern', { filter: { on: T, pattern: { skuu: 'L*' } } }],
        ['under not', { filter: { on: T, not: { eq: { knd: 'lamp' } } } }],
        ['sort', { filter: { type: T }, sort: [{ on: T, by: 'prise' }] }],
        ['the newer spelling', { type: T, filter: { eq: { knd: 'lamp' } } }],
        ['a sort in the newer spelling', { type: T, sort: [{ by: 'prise' }] }],
      ] as [string, Q][]) {
        let got = await run(query);
        isRefusedWith(assert, got, 'unknown-field', place);
        assert.true(
          /"(kind|price|title|sku)"/.test(got.message),
          `${place}: the message names the nearest field (${got.message.slice(0, 160)})`,
        );
      }
    });

    test('[run] a name every object has, or a path that is not a path, is unknown-field in a filter and never reaches SQL as text', async function (assert) {
      for (let name of [
        ...INHERITED_NAMES,
        ...MALFORMED_PATHS,
        'kind.constructor',
        'kind[0]',
        'kind.',
      ]) {
        let shown = JSON.stringify(name);
        for (let [place, filter] of [
          ['eq', { on: T, eq: keyed(name, 'lamp') }],
          ['range', { on: T, range: keyed(name, { gt: 1 }) }],
          ['in', { on: T, in: keyed(name, ['lamp']) }],
          ['contains', { on: T, contains: keyed(name, 'la') }],
        ] as [string, Q][]) {
          let got: Outcome & { names?: string[] } = {
            refused: false,
            kind: 'not run',
            code: undefined,
            message: '',
          };
          let sql = await statements(async () => {
            got = await run({ filter });
          });
          isRefusedWith(assert, got, 'unknown-field', `${place} ${shown}`);
          // The four inherited names are ordinary words; the others would
          // only be in a statement if the path had been written into it.
          if (name.length > 0 && !INHERITED_NAMES.includes(name)) {
            assert.false(
              sql.some((text) => text.includes(name)),
              `${place} ${shown}: the name is in no statement`,
            );
          }
        }
      }
    });

    test('[run] a `[]` path is unknown-field in the newer spelling; the older spelling runs it as it always has', async function (assert) {
      // Compatibility rule: the older spelling has always accepted `[]` in a
      // path, so a saved query keeps running and keeps its answer. Its path
      // walk (unchanged from origin/main) looks the field up without the `[]`
      // and reads the path as a list: on this scalar field there is no list
      // element, so no card matches. The newer spelling has no `[]` path
      // syntax and refuses it.
      for (let [place, filter] of [
        ['eq', { eq: keyed('kind[]', 'lamp') }],
        ['in', { in: keyed('kind[]', ['lamp']) }],
      ] as [string, Q][]) {
        // As written: the engine lowers it itself, so it sees the `[]`.
        let newer: Outcome;
        try {
          await engine.searchCards(realmURL, { type: T, filter } as Query);
          newer = { refused: false, kind: 'ran', code: undefined, message: '' };
        } catch (e) {
          newer = describeError(e);
        }
        isRefusedWith(
          assert,
          newer,
          'unknown-field',
          `newer spelling, ${place}`,
        );
        let older = await run({ filter: { on: T, ...filter } });
        assert.false(
          older.refused,
          `older spelling, ${place}: runs (${older.message})`,
        );
        assert.deepEqual(
          older.names,
          [],
          `older spelling, ${place}: a list path over a scalar matches no card`,
        );
      }
    });

    test('[run] the same names in a sort are unknown-field', async function (assert) {
      for (let name of [...INHERITED_NAMES, ...MALFORMED_PATHS]) {
        let shown = JSON.stringify(name);
        let got: Outcome = {
          refused: false,
          kind: 'not run',
          code: undefined,
          message: '',
        };
        let sql = await statements(async () => {
          got = await run({
            filter: { type: T },
            sort: [{ on: T, by: name }],
          });
        });
        isRefusedWith(assert, got, 'unknown-field', `sort by ${shown}`);
        if (name.length > 0 && !INHERITED_NAMES.includes(name)) {
          assert.false(
            sql.some((text) => text.includes(name)),
            `sort by ${shown}: the name is in no statement`,
          );
        }
      }
    });

    test('[run] an inherited name in a facet is unknown-field', async function (assert) {
      // docs/search.md (Refusals): a facet's `by` the type does not declare
      // is unknown-field when no card of the type holds a value there, as a
      // filter or a sort on it is. No card holds a value at these names.
      for (let name of [...INHERITED_NAMES, 'nope']) {
        let got = await run({
          filter: { type: T },
          facets: [{ by: name }],
        });
        isRefusedWith(assert, got, 'unknown-field', `facet by ${name}`);
      }
    });

    test('[run] an inherited name as a select column is unknown-field', async function (assert) {
      for (let name of [...INHERITED_NAMES, 'nope', 'kind.constructor']) {
        let got: Outcome;
        try {
          await engine.planColumns(T, [{ name, path: name }]);
          got = {
            refused: false,
            kind: 'planned',
            code: undefined,
            message: '',
          };
        } catch (e) {
          got = describeError(e);
        }
        isRefusedWith(assert, got, 'unknown-field', `select ${name}`);
      }
      let plans = await engine.planColumns(T, [{ name: 'kind', path: 'kind' }]);
      assert.strictEqual(plans.length, 1, 'a real field plans');
    });

    test('[run] a request whose filter names __proto__ does not turn into a search for everything', async function (assert) {
      // As a request body carries it: a JSON object with that key.
      for (let body of [
        `{"filter":{"item.on":${JSON.stringify(T)},"eq":{"item.__proto__":"lamp"}}}`,
        `{"filter":{"item.on":${JSON.stringify(T)},"eq":{"item.__proto__":{"kind":"lamp"}}}}`,
        `{"type":${JSON.stringify(T)},"filter":{"eq":{"__proto__":"lamp"}}}`,
        `{"filter":{"item.on":${JSON.stringify(T)},"range":{"item.__proto__":{"gt":1}}}}`,
        `{"filter":{"item.on":${JSON.stringify(T)},"in":{"item.__proto__":["lamp"]}}}`,
      ]) {
        let got: Outcome & { names?: string[] };
        try {
          let { itemQuery } = parseSearchEntryQueryFromPayload(
            JSON.parse(body),
          );
          got = await run(itemQuery as Q);
        } catch (e) {
          got = describeError(e);
        }
        assert.true(
          got.refused,
          `${body.slice(0, 90)}: refused, when read or when run (was: ${got.kind}${got.names ? `, returning ${got.names.length} rows` : ''} ${got.message.slice(0, 80)})`,
        );
        assert.strictEqual(
          got.code,
          'unknown-field',
          `${body.slice(0, 90)}: as an unknown field`,
        );
      }
    });

    test('[run] a log query is refused with the card grammar’s codes', async function (assert) {
      for (let [payload, code] of [
        [{ from: { log: 'Listing/history.jsonl' }, fliter: {} }, 'unknown-key'],
        [{ from: { log: 'Listing/history.jsonl', file: 'x' } }, 'unknown-key'],
        [
          { from: { log: 'Listing/history.jsonl' }, select: 'at' },
          'invalid-value',
        ],
        [
          {
            from: { log: 'Listing/history.jsonl' },
            select: ['at'],
            group: { by: 'actor', count: true },
          },
          'conflicting-members',
        ],
      ] as [Record<string, unknown>, string][]) {
        let { status, body } = await logSearchResponse(
          adapter,
          realm,
          payload as any,
        );
        assert.strictEqual(status, 400, JSON.stringify(payload).slice(0, 80));
        assert.strictEqual((body as any)?.errors?.[0]?.code, code, 'the code');
      }
    });

    // The SQLite index runs only in the browser tests. These go through the
    // engine's own refusals with an adapter that says it is SQLite and runs
    // no statement, so they show the code a caller of that index is given,
    // not that SQLite itself was asked.
    test('[run] features the SQLite index cannot run are needs-postgres', async function (assert) {
      let asked: string[] = [];
      let sqlite = {
        kind: 'sqlite',
        isClosed: false,
        async execute(sql: string) {
          asked.push(sql);
          throw new Error('this index runs no statement');
        },
        async close() {},
        async getColumnNames() {
          return [];
        },
      } as unknown as DBAdapter;
      let browserEngine = new IndexQueryEngine(
        sqlite,
        makeDefinitionLookup(),
        new VirtualNetwork(),
      );
      isRefusedWith(
        assert,
        await run({ filter: { on: T, regex: { sku: '^LMP' } } }, browserEngine),
        'needs-postgres',
        'a regex filter',
      );
      isRefusedWith(
        assert,
        await run(
          {
            filter: { on: T, not: { regex: { sku: '^LMP' } } },
          },
          browserEngine,
        ),
        'needs-postgres',
        'a regex under not',
      );
      let planned: Outcome;
      try {
        await browserEngine.planColumns(T, [{ name: 'kind', path: 'kind' }]);
        planned = {
          refused: false,
          kind: 'planned',
          code: undefined,
          message: '',
        };
      } catch (e) {
        planned = describeError(e);
      }
      isRefusedWith(assert, planned, 'needs-postgres', 'select');
      isRefusedWith(
        assert,
        await run(
          { type: T, sort: [{ expression: 'price * 2' }] },
          browserEngine,
        ),
        'needs-postgres',
        'an expression sort',
      );
      // The browser index keeps no facet table.
      isRefusedWith(
        assert,
        await run({ type: T, facets: [{ by: 'kind' }] }, browserEngine),
        'needs-postgres',
        'a facet',
      );
      assert.deepEqual(asked, [], 'each was refused before any statement');
    });
  });
});
