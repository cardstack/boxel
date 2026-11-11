import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  appendThroughLogIndex,
  dropLogPartition,
  ensureLogPartition,
  syncLogLineIndex,
  logLineSyncStats,
  markLogRewritten,
  param,
  query,
  runLogQuery,
  syncLogFile,
  type DBAdapter,
  type Expression,
  type LogFileSource,
  type LogLineIndexHost,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';

// A log's line rows cost what was added to it, never the whole log
// (`log-line-index.ts`): the realm indexes its own appends as they land
// (write-through), a pass reads only the bytes past the indexed offset, and
// the whole file is read only to rebuild the rows when the file shrank, its
// last indexed line changed, or the realm rewrote it. The file here is bytes
// in memory, read through a source that counts what it hands back.

const realm = 'http://log-sync-test/';
const url = `${realm}Feed/history.jsonl`;

// Every line the same length, whatever its number, so what a pass reads can
// be compared across a log's life.
function line(i: number, pad = 0) {
  return `${JSON.stringify({
    at: `2026-11-10 06:${String(i % 60).padStart(2, '0')}:00`,
    actor: '@ada:test',
    what: { n: i, pad: 'x'.repeat(pad + 4 - String(i).length) },
  })}\n`;
}

module(basename(import.meta.filename), function () {
  module('log line sync (Postgres integration)', function (hooks) {
    let dbAdapter: PgAdapter;
    let file: Uint8Array;
    let bytesRead: number;
    let reads: number;
    let host: LogLineIndexHost;

    let source: LogFileSource = {
      async read(_url, start, end) {
        if (!file) return undefined;
        let from = Math.min(start, file.byteLength);
        let to = Math.min(end ?? file.byteLength, file.byteLength);
        let bytes = file.subarray(from, Math.max(from, to));
        bytesRead += bytes.byteLength;
        if (bytes.byteLength) reads++;
        return { bytes, size: file.byteLength };
      },
    };

    // The realm's append: the bytes land, then their rows, in a transaction.
    async function realmAppend(text: string) {
      let added = new TextEncoder().encode(text);
      let next = new Uint8Array(file.byteLength + added.byteLength);
      next.set(file);
      next.set(added, file.byteLength);
      file = next;
      return await dbAdapter.withTransaction(
        async (tx) =>
          await appendThroughLogIndex(
            { ...host, query: (e) => tx(e) },
            url,
            text,
            file.byteLength,
          ),
      );
    }

    // An append the realm did not index (another writer, or a crash between
    // the write and its rows).
    function rawAppend(text: string) {
      let added = new TextEncoder().encode(text);
      let next = new Uint8Array(file.byteLength + added.byteLength);
      next.set(file);
      next.set(added, file.byteLength);
      file = next;
    }

    let setText = (text: string) => (file = new TextEncoder().encode(text));

    async function lines(): Promise<number[]> {
      let result = await runLogQuery(dbAdapter, realm, {
        from: { log: url },
        page: { size: 1000 },
      });
      return result.data.map((r) => (r.entry as any).what.n);
    }

    async function count(): Promise<number> {
      let [row] = (await query(dbAdapter, [
        'SELECT COUNT(*) AS n FROM boxel_log_lines WHERE url =',
        param(url),
      ] as Expression)) as { n: unknown }[];
      return Number(row.n);
    }

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        file = new Uint8Array();
        bytesRead = 0;
        reads = 0;
        host = {
          dbAdapter,
          realmURL: realm,
          query: (e: Expression) => query(dbAdapter, e) as any,
          readLogFile: source,
        };
      },
    });

    test('the realm’s append is searchable when it returns, and the pass after it reads nothing', async function (assert) {
      setText(line(1));
      await syncLogFile(host, url);
      bytesRead = 0;
      assert.true(await realmAppend(line(2)), 'indexed as it landed');
      assert.deepEqual(await lines(), [1, 2], 'searchable at once');
      assert.strictEqual(bytesRead, 0, 'the append read nothing');
      assert.deepEqual(await syncLogFile(host, url), {
        inserted: 0,
        rebuilt: false,
      });
      assert.strictEqual(bytesRead, 0, 'nor did the pass');
    });

    test('N appends read O(N) bytes: each costs its own bytes, however long the log', async function (assert) {
      setText('');
      await syncLogFile(host, url);
      // Appends the realm did not index, each followed by a pass: the pass
      // reads the new line and the last indexed line, never the prefix.
      let costs: number[] = [];
      for (let i = 1; i <= 200; i++) {
        rawAppend(line(i, 40));
        bytesRead = 0;
        reads = 0;
        await syncLogFile(host, url);
        costs.push(bytesRead);
        assert.true(reads <= 2, `pass ${i} read at most twice`);
      }
      let lineBytes = new TextEncoder().encode(line(1, 40)).byteLength;
      // The first pass reads one line; every later one at most two lines'
      // worth (this one and the last indexed), whatever the log's length.
      assert.true(
        costs.every((c) => c <= 2 * lineBytes + 4),
        `per-pass bytes stay bounded: max ${Math.max(...costs)}`,
      );
      assert.strictEqual(
        costs[199],
        costs[1],
        'the 200th pass reads what the 2nd did',
      );
      assert.strictEqual(await count(), 200);
      assert.deepEqual(
        await lines(),
        Array.from({ length: 200 }, (_, i) => i + 1),
      );
    });

    test('a partial last line waits for its terminator, then is indexed once', async function (assert) {
      setText(line(1));
      await syncLogFile(host, url);
      let half = line(2).slice(0, 20);
      rawAppend(half);
      assert.deepEqual(await syncLogFile(host, url), {
        inserted: 0,
        rebuilt: false,
      });
      assert.false(
        await realmAppend(line(3)),
        'an append after a partial line is left to the pass',
      );
      // The partial line completes as one line with the next.
      assert.deepEqual(await syncLogFile(host, url), {
        inserted: 1,
        rebuilt: false,
      });
      assert.strictEqual(await count(), 2);
    });

    test('concurrent appends: one the write-through cannot place is synced by the pass, with no line twice', async function (assert) {
      setText(line(1));
      await syncLogFile(host, url);
      // B's bytes land before A's rows: A is not where the state says the
      // next bytes begin, so A leaves them to the pass.
      rawAppend(line(2));
      assert.false(await realmAppend(line(3)));
      assert.deepEqual(await syncLogFile(host, url), {
        inserted: 2,
        rebuilt: false,
      });
      assert.true(await realmAppend(line(4)), 'and the next append is placed');
      // Two syncs at once take turns on the log's lock.
      rawAppend(line(5));
      await Promise.all([
        dbAdapter.withTransaction(
          async (tx) =>
            await syncLogFile({ ...host, query: (e) => tx(e) }, url),
        ),
        dbAdapter.withTransaction(
          async (tx) =>
            await syncLogFile({ ...host, query: (e) => tx(e) }, url),
        ),
      ]);
      assert.deepEqual(await lines(), [1, 2, 3, 4, 5]);
    });

    test('an edit to line 1 the realm made rebuilds the rows, and is counted', async function (assert) {
      setText(line(1) + line(2) + line(3));
      await syncLogFile(host, url);
      let before = logLineSyncStats.fullResync;
      setText(line(9) + line(2) + line(3));
      await markLogRewritten(host, url);
      assert.deepEqual(await syncLogFile(host, url), {
        inserted: 3,
        rebuilt: true,
      });
      assert.deepEqual(await lines(), [9, 2, 3]);
      assert.strictEqual(logLineSyncStats.fullResync, before + 1, 'counted');
      assert.true((logLineSyncStats.fullResyncReasons.rewritten ?? 0) > 0);
    });

    test('a changed last line, or a shorter file, rebuilds the rows', async function (assert) {
      setText(line(1) + line(2));
      await syncLogFile(host, url);
      // The last indexed line rewritten, and a line appended after it.
      setText(line(1) + line(7) + line(3));
      assert.deepEqual(await syncLogFile(host, url), {
        inserted: 3,
        rebuilt: true,
      });
      assert.deepEqual(await lines(), [1, 7, 3]);
      // Truncated.
      setText(line(1));
      assert.deepEqual(await syncLogFile(host, url), {
        inserted: 1,
        rebuilt: true,
      });
      assert.deepEqual(await lines(), [1]);
    });

    test('a crash between the append and its rows is recovered by the next pass', async function (assert) {
      setText(line(1));
      await syncLogFile(host, url);
      // The bytes landed; the write-through never ran.
      rawAppend(line(2));
      rawAppend(line(3));
      assert.deepEqual(await syncLogFile(host, url), {
        inserted: 2,
        rebuilt: false,
      });
      assert.deepEqual(await lines(), [1, 2, 3]);
    });

    test('a write-through that fails leaves the rows as they were for the pass to sync', async function (assert) {
      setText(line(1));
      await syncLogFile(host, url);
      rawAppend(line(2));
      await assert.rejects(
        dbAdapter.withTransaction(async (tx) => {
          await appendThroughLogIndex(
            { ...host, query: (e) => tx(e) },
            url,
            line(2),
            file.byteLength,
          );
          throw new Error('crash after the rows, before the commit');
        }),
      );
      assert.strictEqual(await count(), 1, 'rolled back with its transaction');
      await syncLogFile(host, url);
      assert.deepEqual(await lines(), [1, 2]);
    });
  });

  module('log line partitions (Postgres integration)', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
      },
    });

    let serial = 0;
    let freshRealm = () =>
      `http://log-partition-${Date.now()}-${serial++}.test/r/`;

    let text = (n: number) =>
      Array.from(
        { length: n },
        (_, i) =>
          `${JSON.stringify({ at: `2026-11-10 06:${String(i % 60).padStart(2, '0')}:00`, actor: '@ada:test', what: { n: i } })}\n`,
      ).join('');

    function hostFor(
      realmURL: string,
      files: Map<string, string>,
    ): LogLineIndexHost {
      return {
        dbAdapter,
        realmURL,
        query: (e: Expression) => query(dbAdapter, e) as any,
        readLogFile: async (u) =>
          files.has(u) ? { content: files.get(u)! } : undefined,
      };
    }

    async function partitionOf(realmURL: string): Promise<string | undefined> {
      let [row] = (await query(dbAdapter, [
        'SELECT partition_name FROM boxel_log_realms WHERE realm_url =',
        param(realmURL),
      ] as Expression)) as { partition_name?: string }[];
      return row?.partition_name;
    }

    async function rowsIn(table: string, realmURL: string): Promise<number> {
      let [row] = (await query(dbAdapter, [
        `SELECT COUNT(*) AS n FROM ${table} WHERE realm_url =`,
        param(realmURL),
      ] as Expression)) as { n: unknown }[];
      return Number(row.n);
    }

    async function exists(table: string): Promise<boolean> {
      let [row] = (await query(dbAdapter, [
        'SELECT to_regclass(',
        param(table),
        ') IS NOT NULL AS present',
      ] as Expression)) as { present: boolean }[];
      return Boolean(row.present);
    }

    test('a realm’s first query makes its partition, and moves its lines into it', async function (assert) {
      let realmURL = freshRealm();
      let url = `${realmURL}a.jsonl`;
      let files = new Map([[url, text(3)]]);
      // An index pass runs in a transaction, which makes no partition.
      await syncLogLineIndex(hostFor(realmURL, files), [url]);
      assert.strictEqual(await partitionOf(realmURL), undefined);
      await runLogQuery(dbAdapter, realmURL, { from: { log: url } });
      let name = await partitionOf(realmURL);
      assert.ok(name, 'a partition is recorded');
      assert.true(/^boxel_log_lines_[a-z0-9_]+$/.test(name!), name);
      assert.strictEqual(await rowsIn(name!, realmURL), 3);
      assert.strictEqual(await rowsIn('boxel_log_lines_default', realmURL), 0);
    });

    test('two realms writing their first lines at once each get a partition', async function (assert) {
      let a = freshRealm();
      let b = freshRealm();
      await Promise.all([
        ensureLogPartition(dbAdapter, a),
        ensureLogPartition(dbAdapter, b),
        ensureLogPartition(dbAdapter, a),
      ]);
      let [pa, pb] = [await partitionOf(a), await partitionOf(b)];
      assert.ok(pa, 'the first realm has one');
      assert.ok(pb, 'and so has the second');
      assert.notStrictEqual(pa, pb);
      assert.true(await exists(pa!));
      assert.true(await exists(pb!));
    });

    test('lines written before the partition existed are moved into it', async function (assert) {
      let realmURL = freshRealm();
      let url = `${realmURL}a.jsonl`;
      // Synced without a partition: the lines land in the default one.
      await syncLogFile(hostFor(realmURL, new Map([[url, text(4)]])), url);
      assert.strictEqual(await rowsIn('boxel_log_lines_default', realmURL), 4);
      await ensureLogPartition(dbAdapter, realmURL);
      let name = await partitionOf(realmURL);
      assert.strictEqual(await rowsIn('boxel_log_lines_default', realmURL), 0);
      assert.strictEqual(await rowsIn(name!, realmURL), 4);
      let result = await runLogQuery(dbAdapter, realmURL, {
        from: { log: url },
      });
      assert.strictEqual(result.data.length, 4, 'and are read as before');
    });

    test('deleting a realm drops its partition', async function (assert) {
      let realmURL = freshRealm();
      let url = `${realmURL}a.jsonl`;
      await syncLogLineIndex(hostFor(realmURL, new Map([[url, text(2)]])), [
        url,
      ]);
      await ensureLogPartition(dbAdapter, realmURL);
      let name = (await partitionOf(realmURL))!;
      await dropLogPartition(
        dbAdapter,
        (e) => query(dbAdapter, e) as any,
        realmURL,
      );
      assert.false(await exists(name), 'the partition is gone');
      assert.strictEqual(await partitionOf(realmURL), undefined);
      assert.strictEqual(await rowsIn('boxel_log_lines', realmURL), 0);
    });

    // The statements a log query runs, with their bound values.
    async function statementsOf(realmURL: string, q: Record<string, unknown>) {
      let seen: { sql: string; bind: unknown[] }[] = [];
      let reader = new Proxy(dbAdapter, {
        get(target, key, receiver) {
          if (key === 'execute') {
            return async (sql: string, opts?: { bind?: unknown[] }) => {
              seen.push({ sql, bind: opts?.bind ?? [] });
              return await target.execute(sql, opts as any);
            };
          }
          return Reflect.get(target, key, receiver);
        },
      }) as unknown as DBAdapter;
      await runLogQuery(dbAdapter, realmURL, q as any, { reader });
      return seen;
    }

    // The plan of one statement, on one connection with `settings` applied
    // to it alone.
    async function plan(
      sql: string,
      bind: unknown[],
      settings: string[] = [],
    ): Promise<string> {
      return await dbAdapter.withReadSnapshot!(async (reader) => {
        for (let setting of settings) await reader.execute(setting);
        let rows = await reader.execute(`EXPLAIN ${sql}`, {
          bind: bind as any,
        });
        return rows.map((r) => String(Object.values(r)[0])).join('\n');
      });
    }

    test('a log query reads only its realm’s partition', async function (assert) {
      let a = freshRealm();
      let b = freshRealm();
      for (let realmURL of [a, b]) {
        let url = `${realmURL}a.jsonl`;
        await syncLogLineIndex(hostFor(realmURL, new Map([[url, text(5)]])), [
          url,
        ]);
        await ensureLogPartition(dbAdapter, realmURL);
      }
      let [pa, pb] = [(await partitionOf(a))!, (await partitionOf(b))!];
      let statements = await statementsOf(a, {
        from: { log: `${a}a.jsonl` },
        filter: { eq: { 'what.n': 1 } },
        page: { size: 2, total: 'exact' },
        facets: [{ by: 'actor' }],
      });
      assert.true(statements.length >= 2, 'the page, its count and a facet');
      for (let { sql, bind } of statements) {
        let shown = await plan(sql, bind);
        assert.true(shown.includes(pa), `reads ${pa}: ${shown}`);
        assert.false(shown.includes(pb), 'and not the other realm’s');
        assert.false(
          shown.includes('boxel_log_lines_default'),
          'nor the default',
        );
      }
    });

    test('a newest-first page of a log is an ordered index scan', async function (assert) {
      let realmURL = freshRealm();
      let url = `${realmURL}a.jsonl`;
      await syncLogLineIndex(hostFor(realmURL, new Map([[url, text(2000)]])), [
        url,
      ]);
      await ensureLogPartition(dbAdapter, realmURL);
      await query(dbAdapter, ['ANALYZE boxel_log_lines'] as Expression);
      let [page] = await statementsOf(realmURL, {
        from: { log: url },
        sort: [{ by: 'at', direction: 'desc' }],
        page: { size: 20, total: 'none' },
      });
      let shown = await plan(page.sql, page.bind, [
        'SET LOCAL enable_seqscan = off',
      ]);
      // A partition's copy of the parent's `(url, at DESC NULLS LAST, line_no)`
      // index is named for its columns.
      assert.true(/Index Scan using \S*url_at_line_no_idx/.test(shown), shown);
      assert.false(/\bSort\b/.test(shown), `no sort node: ${shown}`);
    });
  });
});
