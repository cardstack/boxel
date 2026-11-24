import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { rri } from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import type { Filter } from '@cardstack/runtime-common/query';
import {
  searchCardsForTest,
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';

// Queries over rows the realm's own indexer writes (an empty list, a date and
// a date-time as the indexer stores them), with the answers Query V2 gave at
// row 25c, when the engine differential last compared them with main's
// engine. They were the differential's only cases outside the conformance
// vectors, which query-verification-conformance-test asserts; the
// differential went with main's engine in row 26. Where main answered
// differently, its answer is the fourth column: a change listed in
// docs/search.md, "answers that changed".

const realmURL = new URL(testRealmURLFor('main-written/'));

const FILTERS: Record<string, Record<string, unknown>> = {
  'in on a string list': { in: { tags: ['red'] } },
  'in on a number list': { in: { nums: [5] } },
  'in with null on a list': { in: { tags: [null] } },
  'contains on a string list': { contains: { tags: 're' } },
  'eq on a string list': { eq: { tags: 'red' } },
  'eq null on a list': { eq: { tags: null } },
  'not over a list': { not: { eq: { tags: 'red' } } },
  'range on a number list': { range: { nums: { gt: 10 } } },
  'eq on a date': { eq: { day: '2000-01-01' } },
  'eq on a date with a date-time': { eq: { day: '2000-01-01T00:00:00Z' } },
  'range on a date': { range: { day: { gte: '2000-06-01' } } },
  'eq on a date-time': { eq: { at: '2000-01-01T00:00:00Z' } },
  'range on a date-time': { range: { at: { gte: '2000-06-01T00:00:00Z' } } },
};

// [case, under not, Query V2's answer at 25c, main's answer where it differed]
const ANSWERS: [string, boolean, string[], string[]?][] = [
  ['in on a string list', false, ['red']],
  ['in on a string list', true, ['empty', 'green'], ['empty', 'green', 'red']],
  ['in on a number list', false, ['red']],
  ['in on a number list', true, ['empty', 'green'], ['empty', 'green', 'red']],
  ['in with null on a list', false, ['empty']],
  ['in with null on a list', true, ['green', 'red']],
  ['contains on a string list', false, ['green', 'red']],
  ['contains on a string list', true, ['empty'], ['empty', 'green', 'red']],
  ['eq on a string list', false, ['red']],
  ['eq on a string list', true, ['empty', 'green'], ['empty', 'green', 'red']],
  ['eq null on a list', false, ['empty']],
  ['eq null on a list', true, ['green', 'red']],
  ['not over a list', false, ['empty', 'green'], ['empty', 'green', 'red']],
  ['not over a list', true, ['red']],
  ['range on a number list', false, ['red'], ['green', 'red']],
  [
    'range on a number list',
    true,
    ['empty', 'green'],
    ['empty', 'green', 'red'],
  ],
  ['eq on a date', false, ['red']],
  ['eq on a date', true, ['green']],
  ['eq on a date with a date-time', false, ['red'], []],
  ['eq on a date with a date-time', true, ['green'], ['green', 'red']],
  ['range on a date', false, ['green']],
  ['range on a date', true, ['red']],
  // A date-time's queryable value is its UTC wall time (row 00). At 25c it was
  // the machine's local wall time, so this answer depended on the time zone
  // the suite ran in: none matched an exact UTC instant off UTC.
  ['eq on a date-time', false, ['red']],
  ['eq on a date-time', true, ['green']],
  ['range on a date-time', false, ['green']],
  ['range on a date-time', true, ['red']],
];

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: { '*': ['read'] },
    fileSystem: {
      'thing.gts': `
        import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
        import NumberField from "@cardstack/base/number";
        import DateField from "@cardstack/base/date";
        import DateTimeField from "@cardstack/base/datetime";
        export class Thing extends CardDef {
          @field tags = containsMany(StringField);
          @field nums = containsMany(NumberField);
          @field day = contains(DateField);
          @field at = contains(DateTimeField);
        }
      `,
      'red.json': thing({
        tags: ['red', 'blue'],
        nums: [5, 15],
        day: '2000-01-01',
        at: '2000-01-01T00:00:00.000Z',
      }),
      'green.json': thing({
        tags: ['green'],
        nums: [7],
        day: '2001-02-03',
        at: '2001-02-03T04:05:06.000Z',
      }),
      'empty.json': thing({ tags: [], nums: [] }),
    },
    onRealmSetup({ testRealm }: { testRealm: Realm }) {
      realm = testRealm;
    },
  });

  for (let [name, negated, expected] of ANSWERS) {
    test(`${name}${negated ? ', under not' : ''}`, async function (assert) {
      let on = { module: `${realmURL.href}thing`, name: 'Thing' };
      let inner = { on, ...FILTERS[name] } as Filter;
      let filter = (negated ? { on, not: inner } : inner) as Filter;
      let { data, meta } = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        {
          filter,
        },
      );
      let ids = data
        .map((card) => String(card.id).slice(realmURL.href.length))
        .sort();
      assert.deepEqual(ids, expected, 'the cards Query V2 returned at 25c');
      assert.strictEqual(meta.page.total, expected.length, 'and their count');
    });
  }
});

function thing(attributes: Record<string, unknown>) {
  return {
    data: {
      attributes,
      meta: { adoptsFrom: { module: rri('./thing'), name: 'Thing' } },
    },
  };
}
