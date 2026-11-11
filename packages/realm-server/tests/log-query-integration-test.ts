import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  LogQueryError,
  markLogRewritten,
  param,
  parseLogLine,
  query,
  resolveLogTime,
  runLogQuery,
  syncLogFile,
  type Expression,
  type LogLineIndexHost,
  VirtualNetwork,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';

// A log's lines as rows (`boxel_log_lines`): kept in step with the file as
// it grows, and searched through `from: { log }`.

const realmURL = 'http://log-query-test/';
const logURL = `${realmURL}Profile/history.jsonl`;

function event(i: number, action: string, extra: Record<string, unknown> = {}) {
  let minute = String(i % 60).padStart(2, '0');
  return JSON.stringify({
    at: `2026-11-10 06:${minute}:00`,
    actor: '@ada:localhost',
    // JSONLFile's `record` writes `what` as a string.
    what: JSON.stringify({ action, postUri: `at://post/${i}`, ...extra }),
  });
}

module(basename(import.meta.filename), function () {
  module('log lines (Postgres integration)', function (hooks) {
    let dbAdapter: PgAdapter;
    let files: Map<string, string>;
    let host: LogLineIndexHost;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        files = new Map();
        host = {
          dbAdapter,
          realmURL,
          query: (e: Expression) => query(dbAdapter, e) as any,
          readLogFile: async (url) =>
            files.has(url) ? { content: files.get(url)! } : undefined,
        };
      },
    });

    async function lineCount(url = logURL): Promise<number> {
      let [row] = (await query(dbAdapter, [
        'SELECT COUNT(*) AS n FROM boxel_log_lines WHERE url =',
        param(url),
      ] as Expression)) as { n: unknown }[];
      return Number(row.n);
    }

    function write(lines: string[]) {
      files.set(logURL, lines.map((l) => `${l}\n`).join(''));
    }

    test('a first sync indexes every line and decodes a JSON `what`', async function (assert) {
      write([event(1, 'like'), event(2, 'skip')]);
      let result = await syncLogFile(host, logURL);
      assert.deepEqual(result, { inserted: 2, rebuilt: true });
      let page = await runLogQuery(dbAdapter, realmURL, {
        from: { log: 'Profile/history.jsonl' },
      });
      assert.strictEqual(page.data.length, 2);
      assert.deepEqual(
        (page.data[0].entry as { what?: unknown }).what,
        { action: 'like', postUri: 'at://post/1' },
        'what is an object, not a string',
      );
      assert.strictEqual(page.data[0].actor, '@ada:localhost');
      assert.strictEqual(page.data[0].at, '2026-11-10T06:01:00.000Z');
    });

    test('an append inserts only the new lines', async function (assert) {
      write([event(1, 'like'), event(2, 'skip')]);
      await syncLogFile(host, logURL);
      write([event(1, 'like'), event(2, 'skip'), event(3, 'save')]);
      let result = await syncLogFile(host, logURL);
      assert.deepEqual(result, { inserted: 1, rebuilt: false });
      assert.strictEqual(await lineCount(), 3);
    });

    test('an edit to an earlier line rebuilds the rows', async function (assert) {
      write([event(1, 'like'), event(2, 'skip')]);
      await syncLogFile(host, logURL);
      write([event(1, 'like'), event(2, 'hide'), event(3, 'save')]);
      let result = await syncLogFile(host, logURL);
      assert.deepEqual(result, { inserted: 3, rebuilt: true });
      let page = await runLogQuery(dbAdapter, realmURL, {
        from: { log: logURL },
        filter: { eq: { 'what.action': 'hide' } },
      });
      assert.deepEqual(
        page.data.map((r) => r.line),
        [2],
      );
    });

    test('an edit to the first line rebuilds the rows: through the realm, or when it moves the size', async function (assert) {
      write([event(1, 'like'), event(2, 'skip'), event(3, 'save')]);
      await syncLogFile(host, logURL);
      // Line 1 changes in place, the size and the last line as they were: a
      // write the realm makes other than an append marks the log rewritten.
      write([event(1, 'hide'), event(2, 'skip'), event(3, 'save')]);
      await markLogRewritten(host, logURL);
      let result = await syncLogFile(host, logURL);
      assert.deepEqual(result, { inserted: 3, rebuilt: true });
      let page = await runLogQuery(dbAdapter, realmURL, {
        from: { log: logURL },
        filter: { eq: { 'what.action': 'hide' } },
      });
      assert.deepEqual(
        page.data.map((r) => r.line),
        [1],
      );
      let stale = await runLogQuery(dbAdapter, realmURL, {
        from: { log: logURL },
        filter: { eq: { 'what.action': 'like' } },
      });
      assert.deepEqual(stale.data, [], 'no row keeps the old first line');

      // An edit to line 1 that changes its length, then an append: the last
      // indexed line no longer sits where it did, so the log is rebuilt.
      write([
        event(1, 'shared'),
        event(2, 'skip'),
        event(3, 'save'),
        event(4, 'like'),
      ]);
      assert.deepEqual(await syncLogFile(host, logURL), {
        inserted: 4,
        rebuilt: true,
      });
    });

    test('an edit and an append in one pass, or a removed line, rebuild the rows', async function (assert) {
      write([event(1, 'like'), event(2, 'skip')]);
      await syncLogFile(host, logURL);
      write([event(1, 'like'), event(5, 'skip'), event(3, 'save')]);
      assert.deepEqual(await syncLogFile(host, logURL), {
        inserted: 3,
        rebuilt: true,
      });
      write([event(1, 'like'), event(3, 'save')]);
      assert.deepEqual(await syncLogFile(host, logURL), {
        inserted: 2,
        rebuilt: true,
      });
      assert.strictEqual(await lineCount(), 2);
      // Unchanged since: nothing to insert, nothing rebuilt.
      assert.deepEqual(await syncLogFile(host, logURL), {
        inserted: 0,
        rebuilt: false,
      });
    });

    test('a line without its newline waits for it', async function (assert) {
      files.set(logURL, `${event(1, 'like')}\n${event(2, 'skip')}`);
      await syncLogFile(host, logURL);
      assert.strictEqual(await lineCount(), 1, 'only the terminated line');
      files.set(logURL, `${event(1, 'like')}\n${event(2, 'skip')}\n`);
      let result = await syncLogFile(host, logURL);
      assert.deepEqual(result, { inserted: 1, rebuilt: false });
    });

    test('a deleted log loses its rows', async function (assert) {
      write([event(1, 'like')]);
      await syncLogFile(host, logURL);
      files.delete(logURL);
      await syncLogFile(host, logURL);
      assert.strictEqual(await lineCount(), 0);
    });

    test('a .log line reads its time and actor', async function (assert) {
      let row = parseLogLine(
        '2026-11-10 06:39:03 @ada:localhost transferred to intensive care',
        1,
        'log',
      );
      assert.strictEqual(row.at, '2026-11-10T06:39:03.000Z');
      assert.strictEqual(row.actor, '@ada:localhost');
      assert.deepEqual(row.entry, { text: 'transferred to intensive care' });
    });

    test('filters, order, paging, totals and facets', async function (assert) {
      let actions = ['like', 'skip', 'skip', 'save', 'like', 'skip'];
      write(actions.map((a, i) => event(i + 1, a, { dwellMs: (i + 1) * 100 })));
      await syncLogFile(host, logURL);
      let now = Date.parse('2026-11-10T06:07:00.000Z');
      let base = { from: { log: logURL } };

      let likes = await runLogQuery(dbAdapter, realmURL, {
        ...base,
        filter: { eq: { 'what.action': 'like' } },
      });
      assert.deepEqual(
        likes.data.map((r) => r.line),
        [1, 5],
        'eq',
      );
      assert.strictEqual(likes.meta.page.total, 2);

      let kept = await runLogQuery(dbAdapter, realmURL, {
        ...base,
        filter: { in: { 'what.action': ['like', 'save'] } },
        sort: [{ by: 'at', direction: 'desc' }],
      });
      assert.deepEqual(
        kept.data.map((r) => r.line),
        [5, 4, 1],
        'in, newest first',
      );

      let long = await runLogQuery(dbAdapter, realmURL, {
        ...base,
        filter: {
          every: [
            { range: { 'what.dwellMs': { gte: 300 } } },
            { not: { eq: { 'what.action': 'skip' } } },
          ],
        },
      });
      assert.deepEqual(
        long.data.map((r) => r.line),
        [4, 5],
        'numeric range and not',
      );

      let recent = resolveLogTime('now-3m', new Date(now));
      let lastFew = await runLogQuery(dbAdapter, realmURL, {
        ...base,
        filter: { range: { at: { gte: recent } } },
      });
      assert.deepEqual(
        lastFew.data.map((r) => r.line),
        [4, 5, 6],
        'time range',
      );

      let paged = await runLogQuery(dbAdapter, realmURL, {
        ...base,
        page: { size: 2, number: 1, total: 'exact' },
      });
      assert.deepEqual(
        paged.data.map((r) => r.line),
        [3, 4],
        'second page',
      );
      assert.true(paged.meta.page.hasMore);
      assert.strictEqual(paged.meta.page.total, 6);

      let counts = await runLogQuery(dbAdapter, realmURL, {
        ...base,
        page: { size: 0 },
        facets: [{ by: 'what.action' }],
      });
      assert.deepEqual(
        counts.meta.facets?.['what.action'],
        [
          { value: 'skip', count: 3 },
          { value: 'like', count: 2 },
          { value: 'save', count: 1 },
        ],
        'facet counts, largest first',
      );

      let found = await runLogQuery(dbAdapter, realmURL, {
        ...base,
        filter: { contains: { 'what.postUri': 'post/6' } },
      });
      assert.deepEqual(
        found.data.map((r) => r.line),
        [6],
        'contains',
      );
    });

    test('select projects paths, and an unknown member is refused', async function (assert) {
      write([event(1, 'like', { dwellMs: 900 }), event(2, 'skip')]);
      await syncLogFile(host, logURL);
      let page = await runLogQuery(dbAdapter, realmURL, {
        from: { log: logURL },
        select: ['what.action', 'what.dwellMs', 'at'],
      });
      assert.deepEqual(page.data, [
        {
          line: 1,
          'what.action': 'like',
          'what.dwellMs': 900,
          at: '2026-11-10T06:01:00.000Z',
        },
        {
          line: 2,
          'what.action': 'skip',
          'what.dwellMs': null,
          at: '2026-11-10T06:02:00.000Z',
        },
      ]);
      await assert.rejects(
        runLogQuery(dbAdapter, realmURL, {
          from: { log: logURL },
          fields: ['what'],
        } as any),
        /"fields" is a card query's, and a log query does not support it/,
      );
    });

    test('group by a path, with aggregates, sorted by one', async function (assert) {
      // post 1: like then hide; post 2: skip, skip; post 3: save.
      write([
        event(1, 'like', { postUri: 'p1' }),
        event(2, 'skip', { postUri: 'p2' }),
        event(3, 'hide', { postUri: 'p1' }),
        event(4, 'skip', { postUri: 'p2' }),
        event(5, 'save', { postUri: 'p3' }),
      ]);
      await syncLogFile(host, logURL);
      let page = await runLogQuery(dbAdapter, realmURL, {
        from: { log: logURL },
        group: {
          by: 'what.postUri',
          aggregates: {
            n: { count: true },
            lastAt: { max: 'at' },
            actions: { distinct: 'what.action' },
            latest: { latest: 'what.action' },
          },
        },
        sort: [{ by: 'lastAt', direction: 'desc' }],
        page: { total: 'exact' },
      });
      assert.deepEqual(page.data, [
        {
          group: { 'what.postUri': 'p3' },
          n: 1,
          lastAt: '2026-11-10T06:05:00.000Z',
          actions: ['save'],
          latest: 'save',
        },
        {
          group: { 'what.postUri': 'p2' },
          n: 2,
          lastAt: '2026-11-10T06:04:00.000Z',
          actions: ['skip'],
          latest: 'skip',
        },
        {
          group: { 'what.postUri': 'p1' },
          n: 2,
          lastAt: '2026-11-10T06:03:00.000Z',
          actions: ['hide', 'like'],
          latest: 'hide',
        },
      ]);
      assert.strictEqual(page.meta.page.total, 3, 'three groups');
      let filtered = await runLogQuery(dbAdapter, realmURL, {
        from: { log: logURL },
        filter: { in: { 'what.action': ['like', 'hide', 'save'] } },
        group: { by: ['what.postUri', 'what.action'] },
        page: { size: 1, total: 'capped' },
      });
      assert.deepEqual(filtered.data, [
        { group: { 'what.postUri': 'p1', 'what.action': 'hide' } },
      ]);
      assert.strictEqual(filtered.meta.page.total, 3, 'groups over two paths');
      assert.true(filtered.meta.page.hasMore);
    });

    test('a log outside the realm, or a file that is not a log, is refused', async function (assert) {
      await assert.rejects(
        runLogQuery(dbAdapter, realmURL, {
          from: { log: 'http://elsewhere/log.jsonl' },
        }),
        LogQueryError,
      );
      await assert.rejects(
        runLogQuery(dbAdapter, realmURL, { from: { log: 'notes.txt' } }),
        LogQueryError,
      );
    });

    test('a prefix-form log id resolves through the virtual network', async function (assert) {
      write([event(1, 'like'), event(2, 'skip')]);
      await syncLogFile(host, logURL);
      let virtualNetwork = new VirtualNetwork();
      virtualNetwork.addRealmMapping('@test/logs/', realmURL);
      let page = await runLogQuery(
        dbAdapter,
        realmURL,
        { from: { log: '@test/logs/Profile/history.jsonl' } },
        { virtualNetwork },
      );
      assert.strictEqual(page.meta.log, logURL);
      assert.strictEqual(page.data.length, 2);
      await assert.rejects(
        runLogQuery(dbAdapter, realmURL, {
          from: { log: '@test/logs/Profile/history.jsonl' },
        }),
        LogQueryError,
        'with no virtual network a prefix-form id is refused, not joined as a path',
      );
      let elsewhere = new VirtualNetwork();
      elsewhere.addRealmMapping('@test/other/', 'http://elsewhere/');
      await assert.rejects(
        runLogQuery(
          dbAdapter,
          realmURL,
          { from: { log: '@test/other/history.jsonl' } },
          { virtualNetwork: elsewhere },
        ),
        LogQueryError,
        'a prefix-form id of another realm is refused',
      );
    });

    test('a path or range bound named like an Object member is data, never SQL', async function (assert) {
      files.set(
        logURL,
        [
          JSON.stringify({ at: '2026-11-10 06:01:00', constructor: 'kept' }),
          JSON.stringify({ at: '2026-11-10 06:02:00' }),
        ]
          .map((l) => `${l}\n`)
          .join(''),
      );
      await syncLogFile(host, logURL);
      let from = { log: logURL };
      let exists = await runLogQuery(dbAdapter, realmURL, {
        from,
        filter: { exists: 'constructor' },
      });
      assert.deepEqual(
        exists.data.map((r) => r.line),
        [1],
        'only the line whose entry has a `constructor` member',
      );
      let contains = await runLogQuery(dbAdapter, realmURL, {
        from,
        filter: { contains: { toString: 'x' } },
      });
      assert.strictEqual(contains.data.length, 0, 'no entry has `toString`');
      for (let bound of ['constructor', 'toString', '__proto__']) {
        await assert.rejects(
          runLogQuery(dbAdapter, realmURL, {
            from,
            filter: { range: { at: { [bound]: 'now' } } as any },
          }),
          LogQueryError,
          `range bound ${bound} is refused`,
        );
      }
    });

    test('a time outside the range of dates is refused, not a crash', async function (assert) {
      for (let value of ['now-999999999999y', 1e20]) {
        assert.throws(
          () => resolveLogTime(value),
          LogQueryError,
          `${value} is refused`,
        );
        await assert.rejects(
          runLogQuery(dbAdapter, realmURL, {
            from: { log: logURL },
            filter: { range: { at: { gte: value } } },
          }),
          LogQueryError,
        );
      }
    });
  });
});
