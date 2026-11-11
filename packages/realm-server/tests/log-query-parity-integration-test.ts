import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  logSearchResponse,
  logTimeOrNull,
  parseLogLine,
  param,
  query,
  realmTimeZoneFromIndex,
  resolveLogTime,
  resolveRelativeDate,
  runLogQuery,
  syncLogFile,
  type DBAdapter,
  type Expression,
  type LogLineIndexHost,
  type LogQuery,
} from '@cardstack/runtime-common';

import { removeRealmDatabaseArtifacts } from '../handlers/realm-destruction-utils.ts';
import { setupDB } from './helpers/index.ts';

// A log search held to the bar a card search is (docs/search.md, "Searching
// a log"): a log no pass has synced is synced or refused, never answered as
// empty; one snapshot and one clock per query; UTC everywhere; the card
// grammar's relative dates; structural limits refused with codes, a page
// clamp reported; the card grammar's refusal codes and nearest names; the
// SQL rule for missing values. Every expectation is worked out here.

const realm = 'http://log-parity-test/';
const LOG = 'Profile/history.jsonl';
const logURL = `${realm}${LOG}`;

type Row = Record<string, any>;

function line(at: string | null, actor: string | null, what: Row) {
  return JSON.stringify({
    ...(at !== null ? { at } : {}),
    ...(actor !== null ? { actor } : {}),
    what,
  });
}

module(basename(import.meta.filename), function () {
  module('log query parity (Postgres integration)', function (hooks) {
    let dbAdapter: PgAdapter;
    let files: Map<string, string>;
    let host: LogLineIndexHost;
    let read = async (url: string) =>
      files.has(url) ? { content: files.get(url)! } : undefined;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        files = new Map();
        host = {
          dbAdapter,
          realmURL: realm,
          query: (e: Expression) => query(dbAdapter, e) as any,
          readLogFile: read,
        };
      },
    });

    function write(lines: string[], url = logURL) {
      files.set(url, lines.map((l) => `${l}\n`).join(''));
    }

    async function refusal(q: Row, opts = {}) {
      let { status, body } = await logSearchResponse(
        dbAdapter,
        realm,
        q as LogQuery,
        opts,
      );
      let error = (body as Row).errors?.[0];
      return { status, code: error?.code, message: String(error?.message) };
    }

    // --- M2: a log no pass has synced -------------------------------------

    test('a log written before any pass reached it is synced by its first query, not answered as empty', async function (assert) {
      write([
        line('2026-11-10 06:00:00', '@ada:test', { action: 'like' }),
        line('2026-11-10 06:01:00', '@ada:test', { action: 'skip' }),
      ]);
      let result = await runLogQuery(
        dbAdapter,
        realm,
        { from: { log: LOG }, filter: { eq: { 'what.action': 'like' } } },
        { readLogFile: read },
      );
      assert.deepEqual(
        result.data.map((r) => r.line),
        [1],
      );
      // Synced now: a query that cannot read the file finds the rows.
      let again = await runLogQuery(dbAdapter, realm, { from: { log: LOG } });
      assert.strictEqual(again.data.length, 2);
    });

    test('a log that does not exist is a 404; with no reader an unsynced log is a 409', async function (assert) {
      assert.deepEqual(
        await refusal({ from: { log: LOG } }, { readLogFile: read }),
        {
          status: 404,
          code: 'log-not-found',
          message: `${logURL} does not exist`,
        },
      );
      write([line('2026-11-10 06:00:00', '@ada:test', { action: 'like' })]);
      let unsynced = await refusal({ from: { log: LOG } });
      assert.deepEqual(
        [unsynced.status, unsynced.code],
        [409, 'log-not-indexed'],
      );
    });

    // --- M3: one snapshot --------------------------------------------------

    test('the page, its count and its facets read one snapshot', async function (assert) {
      write(
        Array.from({ length: 5 }, (_, i) =>
          line(`2026-11-10 06:0${i}:00`, '@ada:test', { n: i }),
        ),
      );
      await syncLogFile(host, logURL);
      let snapshots = 0;
      let outside = 0;
      let counting = new Proxy(dbAdapter, {
        get(target, key, receiver) {
          if (key === 'withReadSnapshot') {
            return async (fn: (reader: DBAdapter) => Promise<unknown>) =>
              await target.withReadSnapshot!(async (reader) => {
                snapshots++;
                return await fn(reader);
              });
          }
          if (key === 'execute') {
            return async (...args: unknown[]) => {
              outside++;
              return await (target.execute as any)(...args);
            };
          }
          return Reflect.get(target, key, receiver);
        },
      }) as unknown as DBAdapter;
      let result = await runLogQuery(counting, realm, {
        from: { log: LOG },
        page: { size: 2, total: 'exact' },
        facets: [{ by: 'actor' }, { by: 'what.n' }],
      });
      assert.strictEqual(result.meta.page.total, 5);
      assert.strictEqual(snapshots, 1, 'one snapshot');
      // Outside it: only the check that the log is synced.
      assert.strictEqual(outside, 1, 'nothing of the answer read outside it');
    });

    // --- M4, M6: one clock, the card grammar's relative dates ---------------

    test('relative times are the card grammar’s: the same instant for the same clock', async function (assert) {
      let now = new Date('2026-03-31T15:45:30.250Z');
      for (let value of [
        'now',
        'now-7d',
        'now+1w',
        'now-1M',
        'now+1y',
        'now/d',
        'now-1d/d',
        'now/w',
        'now/M',
        'now-1y/y',
        'now+90m/h',
      ]) {
        assert.strictEqual(
          resolveLogTime(value, now),
          resolveRelativeDate(value, now),
          value,
        );
      }
      // By hand: a calendar month back from the last of March, as the card
      // grammar reads it, and the Monday that starts its week.
      assert.strictEqual(
        resolveLogTime('now/w', now),
        '2026-03-30T00:00:00.000Z',
      );
      assert.strictEqual(
        resolveLogTime('now/M', now),
        '2026-03-01T00:00:00.000Z',
      );
    });

    test('one clock for the whole query: two bounds named alike are one instant', async function (assert) {
      write([
        line('2026-11-09 23:59:59', '@ada:test', { n: 1 }),
        line('2026-11-10 00:00:00', '@ada:test', { n: 2 }),
        line('2026-11-10 12:00:00', '@ada:test', { n: 3 }),
      ]);
      await syncLogFile(host, logURL);
      let now = new Date('2026-11-10T18:00:00.000Z');
      let today = await runLogQuery(
        dbAdapter,
        realm,
        {
          from: { log: LOG },
          filter: {
            every: [
              { range: { at: { gte: 'now/d' } } },
              { range: { at: { lte: 'now' } } },
            ],
          },
        },
        { now },
      );
      assert.deepEqual(
        today.data.map((r) => r.line),
        [2, 3],
        'midnight UTC belongs to today',
      );
      let none = await runLogQuery(
        dbAdapter,
        realm,
        {
          from: { log: LOG },
          filter: {
            every: [
              { range: { at: { gt: 'now' } } },
              { range: { at: { lte: 'now' } } },
            ],
          },
        },
        { now },
      );
      assert.deepEqual(none.data, [], 'after now and up to now: nothing');
    });

    // --- M5: UTC ------------------------------------------------------------

    test('a zoneless time is UTC wherever it is read; text that is no ISO time is no time', async function (assert) {
      assert.strictEqual(
        logTimeOrNull('2026-11-10T10:00'),
        '2026-11-10T10:00:00.000Z',
      );
      assert.strictEqual(
        logTimeOrNull('2026-11-10 10:00:00'),
        '2026-11-10T10:00:00.000Z',
      );
      assert.strictEqual(
        logTimeOrNull('2026-11-10T10:00:00+02:00'),
        '2026-11-10T08:00:00.000Z',
      );
      assert.strictEqual(logTimeOrNull('March 7, 2026'), null);
      assert.strictEqual(logTimeOrNull('2026-02-30'), null);
      assert.strictEqual(
        parseLogLine(line('2026-11-10T10:00', '@a:test', {}), 1, 'jsonl').at,
        '2026-11-10T10:00:00.000Z',
      );
      assert.strictEqual(
        resolveLogTime('2026-11-10T10:00'),
        '2026-11-10T10:00:00.000Z',
        'a zoneless bound is UTC too',
      );
      let bad = await refusal({
        from: { log: LOG },
        filter: { range: { at: { gte: 'March 7, 2026' } } },
      });
      assert.deepEqual([bad.status, bad.code], [400, 'invalid-value']);
    });

    test('day facets and contains on at are UTC whatever the session’s time zone', async function (assert) {
      write([
        line('2026-11-10 00:30:00', '@ada:test', {}),
        line('2026-11-10 23:30:00', '@ada:test', {}),
        line('2026-11-11 00:10:00', '@ada:test', {}),
      ]);
      await syncLogFile(host, logURL);
      let answer = await dbAdapter.withReadSnapshot!(async (reader) => {
        // A zone far from UTC, for this transaction only.
        await reader.execute("SET LOCAL TIME ZONE 'Pacific/Kiritimati'");
        return await runLogQuery(
          dbAdapter,
          realm,
          {
            from: { log: LOG },
            filter: { contains: { at: '2026-11-10T23' } },
            facets: [{ by: 'at' }],
          },
          { reader },
        );
      });
      assert.deepEqual(answer.meta.facets?.at, [
        { value: '2026-11-10', count: 1 },
      ]);
      assert.deepEqual(
        answer.data.map((r) => r.line),
        [2],
      );
      let all = await dbAdapter.withReadSnapshot!(async (reader) => {
        await reader.execute("SET LOCAL TIME ZONE 'America/Los_Angeles'");
        return await runLogQuery(
          dbAdapter,
          realm,
          { from: { log: LOG }, facets: [{ by: 'at' }] },
          { reader },
        );
      });
      assert.deepEqual(all.meta.facets?.at, [
        { value: '2026-11-10', count: 2 },
        { value: '2026-11-11', count: 1 },
      ]);
    });

    // --- time zones: the card grammar's `timeZone` ----------------------

    test('a New York day: day facets and relative bounds follow the zone named', async function (assert) {
      write([
        // 22:30 on November 9 in New York
        line('2026-11-10T03:30:00Z', '@a:test', { n: 1 }),
        // 00:30 on November 10 in New York
        line('2026-11-10T05:30:00Z', '@a:test', { n: 2 }),
      ]);
      await syncLogFile(host, logURL);
      let facets = async (timeZone?: string) =>
        (
          await runLogQuery(dbAdapter, realm, {
            from: { log: LOG },
            facets: [{ by: 'at' }],
            ...(timeZone ? { timeZone } : {}),
          } as LogQuery)
        ).meta;
      let utc = await facets();
      assert.deepEqual(utc.facets?.at, [{ value: '2026-11-10', count: 2 }]);
      assert.strictEqual(utc.timeZone, undefined, 'UTC by default, unsaid');
      let ny = await facets('America/New_York');
      assert.deepEqual(ny.facets?.at, [
        { value: '2026-11-09', count: 1 },
        { value: '2026-11-10', count: 1 },
      ]);
      assert.strictEqual(ny.timeZone, 'America/New_York');
      // 07:00 in New York: today began at 05:00 UTC.
      let today = await runLogQuery(
        dbAdapter,
        realm,
        {
          from: { log: LOG },
          timeZone: 'America/New_York',
          filter: { range: { at: { gte: 'now/d' } } },
        } as LogQuery,
        { now: new Date('2026-11-10T12:00:00Z') },
      );
      assert.deepEqual(
        today.data.map((r) => r.line),
        [2],
      );
    });

    test('the realm’s default zone applies when the query and the caller name none', async function (assert) {
      write([
        line('2026-11-10T03:30:00Z', '@a:test', {}), // November 9 in New York
        line('2026-11-10T05:30:00Z', '@a:test', {}), // November 10 there
      ]);
      await syncLogFile(host, logURL);
      let card = `${realm}realm`;
      await query(dbAdapter, [
        `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
        param(`${card}.json`),
        ',',
        param(card),
        ',',
        param(realm),
        ", 1, 'instance',",
        param(
          JSON.stringify({
            id: card,
            type: 'card',
            attributes: { timeZone: 'America/New_York' },
          }),
        ),
        "::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, false, false,",
        param(Date.now()),
        ',',
        param(1000),
        ')',
      ] as Expression);
      let days = async (q: Row, opts: Row = {}) =>
        (
          await runLogQuery(
            dbAdapter,
            realm,
            { from: { log: LOG }, facets: [{ by: 'at' }], ...q } as LogQuery,
            {
              realmTimeZone: () => realmTimeZoneFromIndex(dbAdapter, realm),
              ...opts,
            },
          )
        ).meta;
      let byRealm = await days({});
      assert.strictEqual(byRealm.timeZone, 'America/New_York');
      assert.strictEqual(byRealm.facets?.at?.length, 2, 'two New York days');
      let byCaller = await days({}, { timeZone: 'UTC' });
      assert.deepEqual(
        byCaller.facets?.at,
        [{ value: '2026-11-10', count: 2 }],
        'the caller’s zone over the realm’s',
      );
      let byQuery = await days({ timeZone: 'UTC' }, { timeZone: 'Asia/Tokyo' });
      assert.deepEqual(
        byQuery.facets?.at,
        [{ value: '2026-11-10', count: 2 }],
        'the query’s over the caller’s',
      );
      assert.strictEqual(byQuery.timeZone, 'UTC', 'a zone the query named');
    });

    test('a DST day in New York: a 23-hour day is one day, and its midnight is where the zone puts it', async function (assert) {
      write([
        line('2026-03-08T04:30:00Z', '@a:test', {}), // March 7, 23:30 EST
        line('2026-03-08T05:30:00Z', '@a:test', {}), // March 8, 00:30 EST
        line('2026-03-09T03:30:00Z', '@a:test', {}), // March 8, 23:30 EDT
        line('2026-03-09T04:30:00Z', '@a:test', {}), // March 9, 00:30 EDT
      ]);
      await syncLogFile(host, logURL);
      let result = await runLogQuery(dbAdapter, realm, {
        from: { log: LOG },
        timeZone: 'America/New_York',
        facets: [{ by: 'at' }],
      } as LogQuery);
      assert.deepEqual(result.meta.facets?.at, [
        { value: '2026-03-08', count: 2 },
        { value: '2026-03-07', count: 1 },
        { value: '2026-03-09', count: 1 },
      ]);
      // 16:00 EDT on March 8: the day began at 05:00 UTC, before the clocks
      // moved.
      let today = await runLogQuery(
        dbAdapter,
        realm,
        {
          from: { log: LOG },
          timeZone: 'America/New_York',
          filter: {
            every: [
              { range: { at: { gte: 'now/d' } } },
              { range: { at: { lte: 'now' } } },
            ],
          },
        } as LogQuery,
        { now: new Date('2026-03-08T20:00:00Z') },
      );
      assert.deepEqual(
        today.data.map((r) => r.line),
        [2],
      );
      let bad = await refusal({ from: { log: LOG }, timeZone: 'Mars/Olympus' });
      assert.deepEqual([bad.status, bad.code], [400, 'invalid-value']);
    });

    // --- M8: structural limits ----------------------------------------------

    test('structural limits are refused with limit-exceeded, never a crash', async function (assert) {
      write([line('2026-11-10 06:00:00', '@ada:test', { n: 1 })]);
      await syncLogFile(host, logURL);
      let deep: Row = { eq: { 'what.n': 1 } };
      for (let i = 0; i < 600; i++) deep = { not: deep };
      let many = <T>(n: number, f: (i: number) => T): T[] =>
        Array.from({ length: n }, (_, i) => f(i));
      let cases: [string, Row][] = [
        ['a filter 600 deep', { filter: deep }],
        [
          'an in of 10,001 values',
          { filter: { in: { 'what.n': many(10_001, (i) => i) } } },
        ],
        ['65 sort keys', { sort: many(65, () => ({ by: 'line' })) }],
        ['9 facets', { facets: many(9, (i) => ({ by: `what.f${i}` })) }],
        ['65 selected paths', { select: many(65, (i) => `what.f${i}`) }],
        ['9 group paths', { group: { by: many(9, (i) => `what.f${i}`) } }],
        [
          '33 aggregates',
          {
            group: {
              by: 'actor',
              aggregates: Object.fromEntries(
                many(
                  33,
                  (i) => [`a${i}`, { count: true }] as [string, unknown],
                ),
              ),
            },
          },
        ],
        [
          'a contains of 10,001 characters',
          { filter: { contains: { actor: 'x'.repeat(10_001) } } },
        ],
        [
          'more than 60,000 compared values in all',
          {
            filter: {
              every: many(7, (k) => ({
                in: { [`what.f${k}`]: many(9_000, (i) => i) },
              })),
            },
          },
        ],
      ];
      for (let [rule, rest] of cases) {
        let answer = await refusal({ from: { log: LOG }, ...rest });
        assert.deepEqual(
          [answer.status, answer.code],
          [400, 'limit-exceeded'],
          rule,
        );
      }
    });

    test('an in past the containment handful compares a list, with the same answer', async function (assert) {
      write(
        Array.from({ length: 50 }, (_, i) =>
          line('2026-11-10 06:00:00', '@ada:test', { n: i, tag: `t${i % 7}` }),
        ),
      );
      await syncLogFile(host, logURL);
      let wanted = Array.from({ length: 5_000 }, (_, i) => i * 3);
      let result = await runLogQuery(dbAdapter, realm, {
        from: { log: LOG },
        filter: { in: { 'what.n': wanted } },
        page: { size: 100 },
      });
      assert.deepEqual(
        result.data.map((r) => (r.entry as Row).what.n),
        Array.from({ length: 50 }, (_, i) => i).filter((n) => n % 3 === 0),
      );
      let negated = await runLogQuery(dbAdapter, realm, {
        from: { log: LOG },
        filter: { not: { in: { 'what.n': wanted } } },
        page: { size: 100 },
      });
      assert.deepEqual(
        negated.data.map((r) => (r.entry as Row).what.n),
        Array.from({ length: 50 }, (_, i) => i).filter((n) => n % 3 !== 0),
      );
    });

    test('a page past its largest size is clamped and says so; a facet size past 1,000 is refused', async function (assert) {
      write([line('2026-11-10 06:00:00', '@ada:test', {})]);
      await syncLogFile(host, logURL);
      let result = await runLogQuery(dbAdapter, realm, {
        from: { log: LOG },
        page: { size: 5000 },
      });
      assert.deepEqual(
        result.meta.warnings?.map((w) => w.code),
        ['page-size-clamped'],
      );
      let unclamped = await runLogQuery(dbAdapter, realm, {
        from: { log: LOG },
        page: { size: 1000 },
      });
      assert.strictEqual(unclamped.meta.warnings, undefined);
      for (let size of [0, 1001, 2.5]) {
        let answer = await refusal({
          from: { log: LOG },
          facets: [{ by: 'actor', size }],
        });
        assert.deepEqual(
          [answer.status, answer.code],
          [400, 'invalid-value'],
          `facet size ${size}`,
        );
      }
    });

    // --- M9: codes and nearest names -----------------------------------------

    test('an unknown member is refused with the nearest name', async function (assert) {
      write([line('2026-11-10 06:00:00', '@ada:test', {})]);
      await syncLogFile(host, logURL);
      for (let [q, near] of [
        [{ filtr: {} }, 'filter'],
        [{ page: { szie: 3 } }, 'size'],
        [{ facets: [{ by: 'actor', sise: 3 }] }, 'size'],
        [{ filter: { eqq: { actor: 'x' } } }, 'eq'],
        [{ filter: { range: { line: { gtee: 1 } } } }, 'gte'],
        [{ group: { by: 'actor', aggregates: { n: { cnt: true } } } }, 'count'],
        [{ sort: [{ by: 'at', dirction: 'desc' }] }, 'direction'],
      ] as [Row, string][]) {
        let answer = await refusal({ from: { log: LOG }, ...q });
        assert.strictEqual(answer.code, 'unknown-key', JSON.stringify(q));
        assert.true(
          answer.message.includes(`did you mean "${near}"?`),
          answer.message,
        );
      }
      let twice = await refusal({
        from: { log: LOG },
        facets: [{ by: 'actor' }, { by: 'actor', size: 3 }],
      });
      assert.deepEqual(
        [twice.status, twice.code],
        [400, 'conflicting-members'],
        'two facets on one path',
      );
      let twiceGrouped = await refusal({
        from: { log: LOG },
        group: { by: ['actor', 'actor'] },
      });
      assert.strictEqual(twiceGrouped.code, 'conflicting-members');
    });

    // --- M10: the SQL rule for a line with no value ---------------------------

    test('a line with no value at a path is kept by neither a comparison nor its not', async function (assert) {
      write([
        line('2026-11-10 06:00:00', '@ada:test', { score: 5, note: 'hello' }),
        line('2026-11-10 06:01:00', null, { score: 'high', note: 7 }),
        line('2026-11-10 06:02:00', '@bo:test', {}),
      ]);
      await syncLogFile(host, logURL);
      let lines = async (filter: Row) =>
        (
          await runLogQuery(dbAdapter, realm, {
            from: { log: LOG },
            filter,
          } as LogQuery)
        ).data.map((r) => r.line);
      // actor: line 2 has none.
      assert.deepEqual(await lines({ eq: { actor: '@ada:test' } }), [1]);
      assert.deepEqual(
        await lines({ not: { eq: { actor: '@ada:test' } } }),
        [3],
      );
      assert.deepEqual(await lines({ eq: { actor: null } }), [2]);
      // A number range: a value that is not a number has none to compare.
      assert.deepEqual(
        await lines({ range: { 'what.score': { gte: 1 } } }),
        [1],
      );
      assert.deepEqual(
        await lines({ not: { range: { 'what.score': { gte: 10 } } } }),
        [1],
      );
      // contains reads text: line 2's 7 is the text "7", line 3 has none.
      assert.deepEqual(await lines({ contains: { 'what.note': 'ell' } }), [1]);
      assert.deepEqual(
        await lines({ not: { contains: { 'what.note': 'ell' } } }),
        [2],
      );
      // range on actor reads the column the realm stamped.
      assert.deepEqual(await lines({ range: { actor: { gte: '@b' } } }), [3]);
    });

    // --- one grammar: card semantics, card-only members refused ---------

    test('a list at a path matches when some item does, and its not keeps an empty list', async function (assert) {
      write([
        line('2026-11-10 06:00:00', '@a:test', { tags: ['x', 'y'] }),
        line('2026-11-10 06:01:00', '@a:test', { tags: [] }),
        line('2026-11-10 06:02:00', '@a:test', { tags: 'x' }),
        line('2026-11-10 06:03:00', '@a:test', { tags: [{ k: 1 }, { k: 2 }] }),
        line('2026-11-10 06:04:00', '@a:test', {}),
      ]);
      await syncLogFile(host, logURL);
      let lines = async (filter: Row) =>
        (
          await runLogQuery(dbAdapter, realm, {
            from: { log: LOG },
            filter,
          } as LogQuery)
        ).data.map((r) => r.line);
      assert.deepEqual(await lines({ eq: { 'what.tags': 'x' } }), [1, 3]);
      assert.deepEqual(
        await lines({ not: { eq: { 'what.tags': 'x' } } }),
        [2, 4],
      );
      assert.deepEqual(await lines({ eq: { 'what.tags': { k: 2 } } }), [4]);
      assert.deepEqual(await lines({ eq: { 'what.tags': { k: 9 } } }), []);
      assert.deepEqual(await lines({ in: { 'what.tags': ['y', 'z'] } }), [1]);
      let many = Array.from({ length: 40 }, (_, i) => `v${i}`).concat('y');
      assert.deepEqual(await lines({ in: { 'what.tags': many } }), [1]);
      assert.deepEqual(
        await lines({ eq: { 'what.tags': ['x', 'y'] } }),
        [1],
        'a list value is compared whole',
      );
      assert.deepEqual(await lines({ missing: 'what.tags' }), [5]);
      assert.deepEqual(
        await lines({ not: { missing: 'what.tags' } }),
        [1, 2, 3, 4],
      );
    });

    test('a card query’s member a log does not support is refused as such', async function (assert) {
      write([line('2026-11-10 06:00:00', '@a:test', {})]);
      await syncLogFile(host, logURL);
      for (let q of [
        { collapse: 'actor' },
        { let: {} },
        { fields: {} },
        { type: { module: 'x', name: 'Y' } },
        { filter: { matches: 'hello' } },
        { filter: { near: {} } },
      ] as Row[]) {
        let answer = await refusal({ from: { log: LOG }, ...q });
        assert.deepEqual(
          [answer.status, answer.code],
          [400, 'not-supported-for-logs'],
          JSON.stringify(q),
        );
      }
      // A retired member is not a card feature a log lacks: no query takes
      // it, so a log query refuses it as a card query does, with the hint.
      for (let [q, hint] of [
        [
          { rerank: { expression: '1' } },
          /re-ranking is a card query's sort entry/,
        ],
        [
          { filter: { typeahead: 'he' } },
          /"typeahead" is not a filter operator/,
        ],
      ] as [Row, RegExp][]) {
        let answer = await refusal({ from: { log: LOG }, ...q });
        assert.deepEqual(
          [answer.status, answer.code],
          [400, 'unknown-key'],
          JSON.stringify(q),
        );
        assert.true(hint.test(answer.message ?? ''), JSON.stringify(q));
      }
      let utc = await refusal({ from: { log: LOG }, timeZone: 'UTC' });
      assert.strictEqual(utc.status, 200, 'timeZone UTC is the default');
    });

    // --- M13: deleting a realm takes its log rows --------------------------

    test('deleting a realm deletes its log lines and file states, and no other realm’s', async function (assert) {
      write([line('2026-11-10 06:00:00', '@ada:test', {})]);
      await syncLogFile(host, logURL);
      let other = 'http://log-parity-other/';
      files.set(
        `${other}x.jsonl`,
        `${line('2026-11-10 06:00:00', '@bo:test', {})}\n`,
      );
      await syncLogFile({ ...host, realmURL: other }, `${other}x.jsonl`);
      await removeRealmDatabaseArtifacts({ dbAdapter, realmURL: realm });
      let count = async (table: string, realmURL: string) =>
        Number(
          (
            (await query(dbAdapter, [
              `SELECT COUNT(*) AS n FROM ${table} WHERE realm_url =`,
              param(realmURL),
            ] as Expression)) as { n: unknown }[]
          )[0].n,
        );
      assert.strictEqual(await count('boxel_log_lines', realm), 0);
      assert.strictEqual(await count('boxel_log_files', realm), 0);
      assert.strictEqual(await count('boxel_log_lines', other), 1);
      assert.strictEqual(await count('boxel_log_files', other), 1);
    });

    test('a realm’s log rows are indexed by realm, and a log’s by actor', async function (assert) {
      let indexes = (
        (await query(dbAdapter, [
          "SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('boxel_log_lines', 'boxel_log_files')",
        ] as Expression)) as { indexname: string; indexdef: string }[]
      ).map((r) => r.indexdef.replace(/^.* USING /, ''));
      assert.true(
        indexes.includes('btree (url, actor, line_no)'),
        JSON.stringify(indexes),
      );
      assert.true(
        indexes.includes('btree (realm_url)'),
        'boxel_log_files by realm; the lines are partitioned by it',
      );
    });
  });
});
