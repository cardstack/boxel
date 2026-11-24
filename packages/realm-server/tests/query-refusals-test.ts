import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { parseSearchEntryQueryFromPayload } from '@cardstack/runtime-common/search-entry';
import {
  INHERITED_NAMES,
  MALFORMED_PATHS,
  type Mistake,
  type Outcome,
  type Q,
  T,
  type UnknownMember,
  acceptedTests,
  describeError,
  f,
  isRefusedWith,
  keyed,
  kind,
  many,
  on,
  s,
  setupRefusalIndex,
  table,
  top,
  unknownMemberTests,
  viaAssert,
  viaWire,
} from './helpers/query-refusals.ts';

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

// 200 filters, each inside the last.
function nested(depth: number, wrap: (inner: Q) => Q): Q {
  let node: Q = { eq: { kind: 'lamp' } };
  for (let i = 0; i < depth; i++) {
    node = wrap(node);
  }
  return node;
}

// ---- codes no test asserted -----------------------------------------------

const UNASSERTED_CODES: Mistake[] = [
  {
    name: 'a field sort with no type anywhere',
    query: { sort: [{ by: 'price' }] },
    wire: { sort: [{ by: 'item.price' }] },
    code: 'sort-needs-type',
  },
  {
    name: 'an `in` of "$a" when there is no let at all',
    query: f({ in: { kind: '$a' } }),
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
  ...['yes', 1, null].map((v) => ({
    name: `page.exactTotal: ${JSON.stringify(v)}`,
    query: top({ page: { size: 10, exactTotal: v } }),
    code: 'invalid-page',
  })),
  ...['yes', 1, null].map((v) => ({
    name: `page.exactNear: ${JSON.stringify(v)}`,
    query: top({ page: { size: 10, exactNear: v } }),
    code: 'invalid-page',
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
];

// ---- members that cannot go together --------------------------------------

const CONFLICTS: Mistake[] = [
  {
    name: 'eq and range in one filter',
    query: f({ eq: { kind: 'lamp' }, range: { price: { gt: 1 } } }),
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
  {
    name: 'sparse fields without asData',
    query: { filter: { on: T, eq: { kind: 'lamp' } }, fields: {} },
    wire: false,
    code: 'conflicting-members',
  },
];

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
    level: 'the page',
    newer: top({ page: { size: 10, numbr: 1 } }),
    unknown: 'numbr',
    nearest: 'number',
    older: { filter: { on, ...kind }, page: { size: 10, numbr: 1 } },
    olderIs: 'ignored',
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
  ['a page of no rows', top({ page: { size: 0 } })],
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
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a code no test asserted', UNASSERTED_CODES);
    table('a wrong kind of value', WRONG_KIND);
    table('members that cannot go together', CONFLICTS);

    unknownMemberTests(UNKNOWN_MEMBERS);

    acceptedTests(ACCEPTED);

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
  });

  // ---- refused only when the query runs -----------------------------------

  module('refused when run (Postgres)', function (hooks) {
    const shared = setupRefusalIndex(hooks);
    const { run, statements } = shared;

    test('the fixture is in the index', async function (assert) {
      let all = await run({ filter: { type: T } });
      assert.deepEqual(all.names, ['four', 'one', 'three', 'two'], all.message);
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
  });
});
