import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  assertQuery,
  InvalidQueryError,
  type Query,
} from '@cardstack/runtime-common';

// Every refusal names its mistake with a code (invalid-query-error.ts lists
// them), so a caller can react to it without parsing the message. The code
// is a required argument, so a refusal written without one fails the type
// check; this test keeps it required and checks that the mistakes a caller
// can make come back with the code they should.

const on = { module: 'http://test-realm/talk', name: 'Talk' };

const MISTAKES: [string, unknown, string][] = [
  ['a filter with no operator', { filter: { every: [{}] } }, 'missing-member'],
  ['a filter that is not an object', { filter: 3 }, 'missing-member'],
  [
    'two operators in one filter',
    { filter: { on, eq: { a: 1 }, range: { b: { gt: 1 } } } },
    'conflicting-members',
  ],
  [
    'in with a non-array value',
    { filter: { on, in: { a: 1 } } },
    'invalid-value',
  ],
  [
    'a range bound that is not a bound',
    { filter: { on, range: { a: { near: 1 } } } },
    'unknown-key',
  ],
  [
    'prefix without matches',
    { filter: { on, eq: { a: 1 }, prefix: true } },
    'conflicting-members',
  ],
  [
    'an engine-only member',
    { filter: { on, matches: 'x', typoQuery: 'y' } },
    'engine-only',
  ],
  ['a sort that is not an array', { sort: {} }, 'invalid-value'],
  [
    'a sort direction',
    { sort: [{ on, by: 'a', direction: 'up' }] },
    'invalid-value',
  ],
  [
    'textRelevance without matches',
    { filter: { type: on }, sort: [{ by: '_matchRelevance' }] },
    'matches-required',
  ],
  [
    'a blend over the limit',
    {
      sort: [
        {
          by: '_blend',
          of: Array.from({ length: 9 }, (_, i) => ({ on, by: `f${i}` })),
        },
      ],
    },
    'limit-exceeded',
  ],
  [
    'a blend in a blend',
    { sort: [{ by: '_blend', of: [{ by: '_blend', of: [{ on, by: 'a' }] }] }] },
    'invalid-nesting',
  ],
  [
    'an unknown blend method',
    { sort: [{ by: '_blend', method: 'sum', of: [{ on, by: 'a' }] }] },
    'invalid-value',
  ],
  [
    'too many facets',
    { facets: Array.from({ length: 9 }, (_, i) => ({ by: `f${i}` })) },
    'limit-exceeded',
  ],
  [
    'an unknown facet member',
    { facets: [{ by: 'a', group: true }] },
    'unknown-key',
  ],
  [
    'ranges beside an interval',
    { facets: [{ by: 'a', ranges: [{ from: 1 }], interval: 'month' }] },
    'conflicting-members',
  ],
  [
    'too many bindings',
    {
      let: Object.fromEntries(
        [1, 2, 3, 4, 5].map((n) => [
          `b${n}`,
          { from: { filter: { type: on } }, select: 'a' },
        ]),
      ),
    },
    'limit-exceeded',
  ],
  [
    'an unknown binding member',
    { let: { b: { from: { filter: { type: on } }, select: 'a', extra: 1 } } },
    'unknown-key',
  ],
  [
    'a binding with no filter',
    { let: { b: { from: {}, select: 'a' } } },
    'missing-member',
  ],
  [
    'a collapse keep out of range',
    { collapse: { by: 'a', keep: 0 } },
    'invalid-value',
  ],
  [
    'an unknown rerank member',
    { rerank: { expression: 'a', model: 'x' } },
    'unknown-key',
  ],
  [
    'a rerank top out of range',
    { rerank: { expression: 'a', top: 10_000 } },
    'invalid-value',
  ],
  [
    'realm beside realms',
    { realm: 'http://a/', realms: ['http://b/'] },
    'conflicting-members',
  ],
  [
    'an empty type',
    { filter: { type: { module: '', name: '' } } },
    'invalid-type',
  ],
  [
    'a near target that is not a vector',
    { filter: { on, near: { v: { to: 'x' } } } },
    'invalid-value',
  ],
];

module(basename(import.meta.filename), function () {
  test('a bare anchor is every card of its type, not a mistake', function (assert) {
    // `{ on }` alone once matched nothing; it now lowers to `{ type }`.
    assertQuery({ filter: { on } } as Query);
    assertQuery({ filter: { every: [{ on }] } } as Query);
    assert.ok(true, 'both are accepted');
  });

  test('a refusal cannot be made without a code', function (assert) {
    assert.strictEqual(
      InvalidQueryError.length,
      2,
      'the constructor takes the message and the code',
    );
  });

  for (let [name, query, code] of MISTAKES) {
    test(`${name} is refused with ${code}`, function (assert) {
      let refusal: unknown;
      try {
        assertQuery(query as Query);
      } catch (e) {
        refusal = e;
      }
      assert.true(refusal instanceof InvalidQueryError, 'refused');
      assert.strictEqual(
        (refusal as InvalidQueryError | undefined)?.code,
        code,
        String((refusal as Error | undefined)?.message),
      );
    });
  }
});
