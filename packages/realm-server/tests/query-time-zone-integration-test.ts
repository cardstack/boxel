import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  assertQuery,
  backfillFacetValues,
  baseCardRef,
  baseRef,
  facetFieldSpecsOf,
  canonicalQuerySignature,
  clockInZone,
  IndexQueryEngine,
  internalKeyFor,
  InvalidQueryError,
  param,
  query,
  resolveRelativeDateInZone,
  withViewerTimeZone,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { exprSortSql } from '@cardstack/runtime-common/formula-sql';
import {
  parseSearchEntryQueryFromPayload,
  searchEntryRealms,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common/search-entry';

import { createVirtualNetwork, setupDB } from './helpers/index.ts';

// A query's `timeZone` (docs/search.md, Time zones): the zone whose calendar
// decides where "today", "this week" and a day bucket start. Stored values
// keep their meaning: a zoneless date-time is a UTC instant, a date is a
// calendar day. Every expectation is reasoned by hand beside its rows; the
// clock is fixed with `queryNow`.

const NY = 'America/New_York';

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const refs = {
  string: ref('@cardstack/base/string', 'default'),
  date: ref('@cardstack/base/date', 'default'),
  datetime: ref('@cardstack/base/datetime', 'default'),
};

const primitive = (fieldOrCard: ResolvedCodeRef, serializerName?: string) => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard,
  ...(serializerName ? { serializerName } : {}),
});

function definition(
  codeRef: ResolvedCodeRef,
  fields: Record<string, unknown>,
  kind: 'card-def' | 'field-def' = 'card-def',
): Definition {
  let all =
    kind === 'card-def' ? { id: primitive(refs.string), ...fields } : fields;
  let names = Object.keys(all);
  return {
    type: kind,
    codeRef,
    displayName: codeRef.name,
    fields: Object.fromEntries(names.map((n, i) => [n, `f${i}`])),
    fieldDefs: Object.fromEntries(
      names.map((n, i) => [`f${i}`, (all as Record<string, unknown>)[n]]),
    ),
  } as unknown as Definition;
}

const tzRealm = 'http://tz-punches/';
const dstRealm = 'http://tz-dst/';
const edgeRealm = 'http://tz-edges/';
const nyRealm = 'http://tz-realm-default/';
const badRealm = 'http://tz-realm-typo/';
const Punch = ref(`${tzRealm}punch`, 'Punch');
const RealmConfig = ref('@cardstack/base/realm-config', 'RealmConfig');

const DEFINITIONS: Definition[] = [
  definition(baseCardRef as ResolvedCodeRef, {}),
  definition(baseRef as ResolvedCodeRef, {}, 'field-def'),
  definition(Punch, {
    at: { ...primitive(refs.datetime, 'datetime'), search: { facet: true } },
    day: { ...primitive(refs.date, 'date'), search: { facet: true } },
  }),
  definition(RealmConfig, { timeZone: primitive(refs.string) }),
];

function makeDefinitionLookup(definitions: Definition[]): DefinitionLookup {
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      let found = definitions.find((d) => {
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
  };
  return lookup;
}

interface Row {
  name: string;
  doc: Record<string, unknown>;
  chain?: ResolvedCodeRef[];
  pristine?: Record<string, unknown>;
}

async function seed(
  dbAdapter: PgAdapter,
  vn: VirtualNetwork,
  realm: string,
  rows: Row[],
) {
  for (let row of rows) {
    let url = `${realm}${row.name}`;
    let chain = row.chain ?? [Punch, baseCardRef as ResolvedCodeRef, baseRef];
    await query(dbAdapter, [
      `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
      param(url),
      `,`,
      param(url.replace(/\.json$/, '')),
      `,`,
      param(realm),
      `,`,
      param(1),
      `,`,
      param('instance'),
      `,`,
      param(JSON.stringify(row.pristine ?? { id: url, type: 'card' })),
      `::jsonb,`,
      param(JSON.stringify({ id: url, ...row.doc })),
      `::jsonb,`,
      `'[]'::jsonb,`,
      param(JSON.stringify(chain.map((r) => internalKeyFor(r, undefined, vn)))),
      `::jsonb,`,
      param(false),
      `,`,
      param(false),
      `,`,
      param(Date.now()),
      `,`,
      param(1_000),
      `)`,
    ]);
  }
  // The rows went straight into boxel_index: their facet rows are written
  // from their search docs, as a declaration change does.
  let punch = DEFINITIONS.find(
    (d) => (d.codeRef as ResolvedCodeRef).name === 'Punch',
  )!;
  await backfillFacetValues(
    dbAdapter,
    realm,
    internalKeyFor(Punch, undefined, vn),
    await facetFieldSpecsOf(punch, async () => undefined),
  );
}

// The clock: 2026-11-10T04:00Z is Tuesday Nov 10 in UTC and Monday Nov 9,
// 23:00, in New York (EST, UTC-5).
const NOW = new Date('2026-11-10T04:00:00.000Z');

// Zoneless date-times, read as UTC; the New York wall time beside each.
const PUNCHES: Row[] = [
  // the attendance punch: Nov 10 in UTC, still Nov 9 in New York
  { name: 'p1', doc: { at: '2026-11-10T03:30', day: '2026-11-09' } }, // NY 11-09 22:30
  { name: 'p2', doc: { at: '2026-11-10T05:30', day: '2026-11-10' } }, // NY 11-10 00:30
  { name: 'p3', doc: { at: '2026-11-09T04:59', day: '2026-11-08' } }, // NY 11-08 23:59
  { name: 'p4', doc: { at: '2026-11-09T05:00', day: '2026-11-09' } }, // NY 11-09 00:00
  { name: 'p5', doc: { at: '2026-11-08T12:00', day: '2026-11-08' } }, // NY 11-08 07:00
];

// Around New York's DST changes: clocks go forward at 2026-03-08T07:00Z (a
// 23-hour day) and back at 2026-11-01T06:00Z (a 25-hour day).
const DST: Row[] = [
  { name: 's1', doc: { at: '2026-03-08T04:30' } }, // NY 03-07 23:30 EST
  { name: 's2', doc: { at: '2026-03-08T05:00' } }, // NY 03-08 00:00 EST
  { name: 's3', doc: { at: '2026-03-09T03:59' } }, // NY 03-08 23:59 EDT
  { name: 's4', doc: { at: '2026-03-09T04:00' } }, // NY 03-09 00:00 EDT
  { name: 'f1', doc: { at: '2026-11-01T03:59' } }, // NY 10-31 23:59 EDT
  { name: 'f2', doc: { at: '2026-11-01T04:00' } }, // NY 11-01 00:00 EDT
  { name: 'f3', doc: { at: '2026-11-02T04:59' } }, // NY 11-01 23:59 EST
  { name: 'f4', doc: { at: '2026-11-02T05:00' } }, // NY 11-02 00:00 EST
];

// Week and month edges.
const EDGES: Row[] = [
  // NY Sunday Nov 8 22:00: week of Nov 2 there, week of Nov 9 in UTC
  { name: 'w1', doc: { at: '2026-11-09T03:00' } },
  // NY Oct 31 22:00: October there, November in UTC
  { name: 'm1', doc: { at: '2026-11-01T02:00' } },
];

const realmConfigRow = (zone: string): Row => ({
  name: 'realm.json',
  doc: { timeZone: zone },
  chain: [RealmConfig, baseCardRef as ResolvedCodeRef, baseRef],
  pristine: { type: 'card', attributes: { timeZone: zone } },
});

const page = { size: 100, total: 'exact' as const };

module(basename(import.meta.filename), function () {
  module('time zones: the shared helper', function () {
    test('relative dates round on the zone calendar', function (assert) {
      let at = (v: string, zone = NY, now = NOW) =>
        resolveRelativeDateInZone(v, now, zone);
      assert.strictEqual(at('now/d'), '2026-11-09T05:00:00.000Z');
      assert.strictEqual(at('now/d', 'UTC'), '2026-11-10T00:00:00.000Z');
      assert.strictEqual(at('now/w'), '2026-11-09T05:00:00.000Z', 'Monday');
      assert.strictEqual(at('now/M'), '2026-11-01T04:00:00.000Z', 'EDT');
      assert.strictEqual(at('now-1M/M'), '2026-10-01T04:00:00.000Z');
      assert.strictEqual(at('now/y'), '2026-01-01T05:00:00.000Z');
      assert.strictEqual(
        at('now/y', NY, new Date('2026-01-01T03:00:00Z')),
        '2025-01-01T05:00:00.000Z',
        'Jan 1 03:00Z is still 2025 in New York',
      );
      assert.strictEqual(at('now-2h'), '2026-11-10T02:00:00.000Z', 'elapsed');
      let spring = new Date('2026-03-08T15:00:00Z');
      assert.strictEqual(at('now/d', NY, spring), '2026-03-08T05:00:00.000Z');
      assert.strictEqual(
        at('now+1d/d', NY, spring),
        '2026-03-09T04:00:00.000Z',
        'a 23-hour day',
      );
      let fall = new Date('2026-11-01T15:00:00Z');
      assert.strictEqual(at('now/d', NY, fall), '2026-11-01T04:00:00.000Z');
      assert.strictEqual(
        at('now+1d/d', NY, fall),
        '2026-11-02T05:00:00.000Z',
        'a 25-hour day',
      );
    });

    test('a zone is an IANA name, in one spelling', async function (assert) {
      for (let bad of ['Mars/Base', '+05:00', '', 5, 'New York']) {
        assert.throws(
          () => assertQuery({ timeZone: bad }),
          (e: any) =>
            e instanceof InvalidQueryError && e.code === 'invalid-value',
          `${JSON.stringify(bad)} is refused`,
        );
      }
      assertQuery({ timeZone: NY });
      assertQuery({ timeZone: 'UTC' });
      assert.throws(
        () => parseSearchEntryQueryFromPayload({ timeZone: 'Mars/Base' }),
        /not a time zone/,
        'over the wire too',
      );
      assert.strictEqual(
        parseSearchEntryQueryFromPayload({ timeZone: 'america/new_york' })
          .itemQuery.timeZone,
        NY,
      );
    });

    test('the zone is part of the signature, in one spelling', function (assert) {
      let vn = createVirtualNetwork();
      let q: Query = { filter: { type: Punch } };
      let sig = (x: Query) => canonicalQuerySignature(x, vn);
      assert.notStrictEqual(sig({ ...q, timeZone: NY }), sig(q));
      assert.notStrictEqual(
        sig({ ...q, timeZone: NY }),
        sig({ ...q, timeZone: 'UTC' }),
      );
      assert.strictEqual(
        sig({ ...q, timeZone: NY }),
        sig({ ...q, timeZone: 'america/new_york' }),
      );
    });

    test('expression SQL in UTC is what it always was', function (assert) {
      for (let expr of ['DAYS(TODAY(), day)', 'DAYS(NOW(), at) * 2']) {
        assert.strictEqual(
          exprSortSql(expr, undefined, clockInZone(NOW, 'UTC')),
          exprSortSql(expr, undefined, NOW),
          expr,
        );
        let zoned = exprSortSql(expr, undefined, clockInZone(NOW, NY));
        assert.notOk(/now\(\)/.test(zoned), `${expr}: one instant`);
        assert.ok(zoned.includes(`AT TIME ZONE '${NY}'`), `${expr}: in NY`);
      }
    });

    test('the viewer zone is applied only when asked', function (assert) {
      let q = { filter: { type: Punch } };
      assert.strictEqual(
        withViewerTimeZone({ ...q, timeZone: 'UTC' }).timeZone,
        'UTC',
        'a query zone stays',
      );
      assert.strictEqual(typeof withViewerTimeZone(q).timeZone, 'string');
      assert.strictEqual((q as any).timeZone, undefined, 'never in place');
    });

    test('a federated search over several realms reckons in one zone', async function (assert) {
      let seen: (string | undefined)[] = [];
      let realm = (url: string) => ({
        url,
        async searchEntries(_q: any, o?: any) {
          seen.push(o?.timeZone);
          return { data: [], meta: { page: { total: 0 } } } as any;
        },
      });
      let entry = parseSearchEntryQueryFromPayload({
        filter: { 'item.on': Punch },
      });
      await searchEntryRealms([realm(tzRealm), realm(nyRealm)], entry);
      assert.deepEqual(seen, ['UTC', 'UTC'], 'UTC, never a realm default');
      seen = [];
      await searchEntryRealms([realm(nyRealm)], entry);
      assert.deepEqual(seen, [undefined], "one realm: that realm's default");
      seen = [];
      await searchEntryRealms(
        [realm(tzRealm), realm(nyRealm)],
        parseSearchEntryQueryFromPayload({
          filter: { 'item.on': Punch },
          timeZone: NY,
        }),
      );
      assert.deepEqual(seen, [undefined, undefined], 'the query zone rides');
    });
  });

  module('time zones (Postgres integration)', function (hooks) {
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      before: async (dbAdapter) => {
        let vn = createVirtualNetwork();
        engine = new IndexQueryEngine(
          dbAdapter,
          makeDefinitionLookup(DEFINITIONS),
          vn,
        );
        await seed(dbAdapter, vn, tzRealm, PUNCHES);
        await seed(dbAdapter, vn, dstRealm, DST);
        await seed(dbAdapter, vn, edgeRealm, EDGES);
        await seed(dbAdapter, vn, nyRealm, [...PUNCHES, realmConfigRow(NY)]);
        await seed(dbAdapter, vn, badRealm, [
          ...PUNCHES,
          realmConfigRow('Mars/Base'),
        ]);
      },
    });

    async function search(
      realm: string,
      q: Record<string, any>,
      opts: Record<string, any> = {},
    ) {
      let { cards, meta } = await engine.searchCards(
        new URL(realm),
        { page, ...q } as Query,
        { queryNow: opts.now ?? NOW, ...opts },
      );
      return {
        names: cards.map((c) => String(c.id).slice(realm.length)).sort(),
        meta: meta as Record<string, any>,
      };
    }
    // the older spelling (an `on` anchor) and the newer (a top-level type)
    let forms = (
      filter: Record<string, any>,
      more: Record<string, any> = {},
    ) => [
      { filter: { on: Punch, ...filter }, ...more },
      { type: Punch, filter, ...more },
    ];
    let counts = (meta: Record<string, any>, by: string) =>
      Object.fromEntries(
        (meta.facets?.[by] ?? []).map((f: any) => [f.value, f.count]),
      );
    let today = { range: { at: { gte: 'now/d', lt: 'now+1d/d' } } };

    test("today is the zone's day: a punch at 03:30Z on Nov 10 is Nov 9 in New York", async function (assert) {
      for (let q of forms(today, { timeZone: NY })) {
        let { names, meta } = await search(tzRealm, q);
        assert.deepEqual(names, ['p1', 'p4'], 'New York');
        assert.strictEqual(meta.timeZone, NY, 'meta.timeZone echoes');
      }
      for (let q of forms(today, { timeZone: 'UTC' })) {
        let { names, meta } = await search(tzRealm, q);
        assert.deepEqual(names, ['p1', 'p2'], 'UTC');
        assert.strictEqual(meta.timeZone, 'UTC', 'a named UTC echoes');
      }
    });

    test('a date field compares with the zone day; its values are never shifted', async function (assert) {
      let filter = { range: { day: { gte: 'now/d' } } };
      let ny = await search(tzRealm, {
        filter: { on: Punch, ...filter },
        timeZone: NY,
      });
      assert.deepEqual(ny.names, ['p1', 'p2', 'p4'], 'NY today is 2026-11-09');
      let utc = await search(tzRealm, { filter: { on: Punch, ...filter } });
      assert.deepEqual(utc.names, ['p2'], 'UTC today is 2026-11-10');
      let facet = { facets: [{ by: 'day', interval: 'day' }] };
      let nyDays = await search(tzRealm, {
        filter: { type: Punch },
        timeZone: NY,
        ...facet,
      });
      let utcDays = await search(tzRealm, {
        filter: { type: Punch },
        ...facet,
      });
      assert.deepEqual(counts(nyDays.meta, 'day'), counts(utcDays.meta, 'day'));
      assert.deepEqual(counts(nyDays.meta, 'day'), {
        '2026-11-08': 2,
        '2026-11-09': 2,
        '2026-11-10': 1,
      });
    });

    test('day buckets are the zone days, labeled as its dates', async function (assert) {
      let facet = { facets: [{ by: 'at', interval: 'day' }] };
      for (let q of [
        { filter: { type: Punch }, timeZone: NY, ...facet },
        { type: Punch, timeZone: NY, ...facet },
      ]) {
        let { meta } = await search(tzRealm, q);
        assert.deepEqual(counts(meta, 'at'), {
          '2026-11-08': 2,
          '2026-11-09': 2,
          '2026-11-10': 1,
        });
      }
      let { meta } = await search(tzRealm, {
        filter: { type: Punch },
        ...facet,
      });
      assert.deepEqual(counts(meta, 'at'), {
        '2026-11-08': 1,
        '2026-11-09': 2,
        '2026-11-10': 2,
      });
    });

    test('facet range bounds resolve in the zone', async function (assert) {
      let facets = [
        { by: 'day', ranges: [{ key: 'today', from: 'now/d' }] },
        { by: 'at', ranges: [{ key: 'today', from: 'now/d', to: 'now+1d/d' }] },
      ];
      let ny = await search(tzRealm, {
        filter: { type: Punch },
        facets,
        timeZone: NY,
      });
      assert.deepEqual(counts(ny.meta, 'day'), { today: 3 });
      assert.deepEqual(counts(ny.meta, 'at'), { today: 2 });
      let utc = await search(tzRealm, { filter: { type: Punch }, facets });
      assert.deepEqual(counts(utc.meta, 'day'), { today: 1 });
      assert.deepEqual(counts(utc.meta, 'at'), { today: 2 });
    });

    test('a 23-hour and a 25-hour day', async function (assert) {
      let spring = await search(
        dstRealm,
        { filter: { on: Punch, ...today }, timeZone: NY },
        { now: new Date('2026-03-08T15:00:00Z') },
      );
      assert.deepEqual(spring.names, ['s2', 's3'], 'Mar 8 in New York');
      let fall = await search(
        dstRealm,
        { filter: { on: Punch, ...today }, timeZone: NY },
        { now: new Date('2026-11-01T15:00:00Z') },
      );
      assert.deepEqual(fall.names, ['f2', 'f3'], 'Nov 1 in New York');
      let { meta } = await search(dstRealm, {
        filter: { type: Punch },
        facets: [{ by: 'at', interval: 'day' }],
        timeZone: NY,
      });
      assert.deepEqual(counts(meta, 'at'), {
        '2026-03-07': 1,
        '2026-03-08': 2,
        '2026-03-09': 1,
        '2026-10-31': 1,
        '2026-11-01': 2,
        '2026-11-02': 1,
      });
    });

    test('week and month buckets and bounds', async function (assert) {
      // two facets on one `by` are one facet; ask separately
      let ask = async (interval: string, timeZone?: string) =>
        counts(
          (
            await search(edgeRealm, {
              filter: { type: Punch },
              facets: [{ by: 'at', interval }],
              ...(timeZone ? { timeZone } : {}),
            })
          ).meta,
          'at',
        );
      assert.deepEqual(await ask('week', NY), {
        '2026-10-26': 1,
        '2026-11-02': 1,
      });
      assert.deepEqual(await ask('week'), { '2026-10-26': 1, '2026-11-09': 1 });
      assert.deepEqual(await ask('month', NY), {
        '2026-10-01': 1,
        '2026-11-01': 1,
      });
      assert.deepEqual(await ask('month'), { '2026-11-01': 2 });
      let thisWeek = { range: { at: { gte: 'now/w' } } };
      assert.deepEqual(
        (
          await search(edgeRealm, {
            filter: { on: Punch, ...thisWeek },
            timeZone: NY,
          })
        ).names,
        [],
        'NY week starts Mon Nov 9 05:00Z',
      );
      assert.deepEqual(
        (await search(edgeRealm, { filter: { on: Punch, ...thisWeek } })).names,
        ['w1'],
        'UTC week starts Mon Nov 9 00:00Z',
      );
      let thisMonth = { range: { at: { gte: 'now/M' } } };
      assert.deepEqual(
        (
          await search(edgeRealm, {
            filter: { on: Punch, ...thisMonth },
            timeZone: NY,
          })
        ).names,
        ['w1'],
      );
      assert.deepEqual(
        (await search(edgeRealm, { filter: { on: Punch, ...thisMonth } }))
          .names,
        ['m1', 'w1'],
      );
    });

    async function sortValues(q: Record<string, any>) {
      let { results } = await engine.search(
        new URL(tzRealm),
        { page, ...q } as Query,
        { queryNow: NOW, exposeSortValues: true },
        { kind: 'dataOnly' },
      );
      return Object.fromEntries(
        results.map((r: any) => [
          String(r.url)
            .slice(tzRealm.length)
            .replace(/\.json$/, ''),
          Number(r._sortValues?.[0]),
        ]),
      );
    }

    test('TODAY() in an expression is the zone midnight (SQL)', async function (assert) {
      let q = (timeZone?: string) => ({
        type: Punch,
        sort: [{ expression: 'DAYS(TODAY(), day)' }],
        ...(timeZone ? { timeZone } : {}),
      });
      assert.deepEqual(await sortValues(q(NY)), {
        p1: 0,
        p2: -1,
        p3: 1,
        p4: 0,
        p5: 1,
      });
      assert.deepEqual(await sortValues(q()), {
        p1: 1,
        p2: 0,
        p3: 2,
        p4: 1,
        p5: 2,
      });
    });

    // Date parts (HOUR, DAY, …) are outside BXL's score profile, so a query
    // expression that reads one is refused, in any zone; DAYS and TODAY() in
    // the zone are pinned above.
    test('date parts in an expression are refused with expression-unsupported', async function (assert) {
      for (let expression of [
        'HOUR(at)',
        'DAY(at)',
        'DAY(TODAY()) + 0 * DAY(at)',
      ]) {
        let error: any;
        try {
          await sortValues({
            type: Punch,
            sort: [{ expression }],
            timeZone: NY,
          });
        } catch (e) {
          error = e;
        }
        assert.strictEqual(error?.code, 'expression-unsupported', expression);
      }
    });

    test('a let binding inherits the zone unless it names its own', async function (assert) {
      let bound = (own?: string) => ({
        filter: { on: Punch, in: { id: '$todays' } },
        let: {
          $todays: {
            from: {
              filter: { on: Punch, ...today },
              ...(own ? { timeZone: own } : {}),
            },
            select: 'id',
          },
        },
        timeZone: NY,
      });
      assert.deepEqual((await search(tzRealm, bound())).names, ['p1', 'p4']);
      assert.deepEqual((await search(tzRealm, bound('UTC'))).names, [
        'p1',
        'p2',
      ]);
    });

    test('over the wire a binding keeps its own zone', async function (assert) {
      // outer UTC, binding New York: at 04:00Z on Nov 10 the binding's
      // "today" is Nov 9 in New York (p1, p4), not Nov 10 in UTC (p1, p2)
      let authored = {
        type: Punch,
        filter: { in: { id: { $let: '$todays' } } },
        let: {
          $todays: {
            from: { type: Punch, filter: today, timeZone: NY },
            select: 'id',
          },
          $first: {
            from: { type: Punch, filter: today, timeZone: NY },
            one: true,
          },
        },
        timeZone: 'UTC',
      } as unknown as Query;
      let direct = (await search(tzRealm, authored as any)).names;
      assert.deepEqual(direct, ['p1', 'p4'], 'direct');
      for (let [label, payload] of [
        ['authored', authored],
        ['serialized', searchEntryWireQueryFromQuery(authored)],
      ] as const) {
        let { itemQuery } = parseSearchEntryQueryFromPayload(payload);
        for (let name of ['$todays', '$first']) {
          assert.strictEqual(
            (itemQuery.let as any)?.[name]?.from?.timeZone,
            NY,
            `${label}: ${name} keeps its zone`,
          );
        }
        let { $first: _first, ...lets } = itemQuery.let as any;
        assert.deepEqual(
          (await search(tzRealm, { ...itemQuery, let: lets })).names,
          direct,
          `${label}: the same cards as the direct call`,
        );
      }
    });

    test("the realm's default zone applies; a query or caller zone beats it", async function (assert) {
      let filter = { on: Punch, ...today };
      let byDefault = await search(nyRealm, { filter });
      assert.deepEqual(byDefault.names, ['p1', 'p4'], 'the realm default');
      assert.strictEqual(byDefault.meta.timeZone, NY);
      let named = await search(nyRealm, { filter, timeZone: 'UTC' });
      assert.deepEqual(named.names, ['p1', 'p2'], 'the query zone wins');
      assert.strictEqual(named.meta.timeZone, 'UTC');
      let federated = await search(nyRealm, { filter }, { timeZone: 'UTC' });
      assert.deepEqual(
        federated.names,
        ['p1', 'p2'],
        'a caller zone (federated UTC) wins',
      );
      assert.strictEqual(federated.meta.timeZone, undefined);
      let typo = await search(badRealm, { filter });
      assert.deepEqual(
        typo.names,
        ['p1', 'p2'],
        'a typo in the realm zone is UTC',
      );
    });

    test('compliance: a query with no zone, in a realm with none, answers as it always did', async function (assert) {
      let facets = [{ by: 'at', interval: 'day' }];
      for (let q of forms(today, { facets })) {
        let none = await search(tzRealm, q);
        let utc = await search(tzRealm, { ...q, timeZone: 'UTC' });
        assert.deepEqual(none.names, utc.names);
        assert.deepEqual(none.meta.facets, utc.meta.facets);
        assert.notOk('timeZone' in none.meta, 'no meta.timeZone');
      }
    });

    test('an unknown zone is refused when the query runs', async function (assert) {
      for (let timeZone of ['Mars/Base', '+05:00']) {
        try {
          await search(tzRealm, { filter: { type: Punch }, timeZone });
          assert.ok(false, `${timeZone} should be refused`);
        } catch (e: any) {
          assert.strictEqual(e.code, 'invalid-value', timeZone);
          assert.ok(String(e.message).includes(timeZone), 'names it');
        }
      }
    });
  });
});
