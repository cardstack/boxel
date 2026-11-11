import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  type DBAdapter,
  type DefinitionLookup,
} from '@cardstack/runtime-common';
import {
  SEARCH_JIT_ABOVE_COST,
  SEARCH_WORK_MEM_KB,
  STATEMENT_TIMEOUT_MARGIN_MS,
  searchSessionSettings,
  statementTimeoutFor,
} from '@cardstack/postgres/pg-adapter';
import {
  SearchBoundError,
  mergeAbortSignals,
  setSignalDeadline,
  signalDeadline,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

// A search under a time budget tells its read snapshot the deadline, and the
// snapshot's transaction sets `statement_timeout` to the time left plus a
// small margin: a backstop that has Postgres stop a runaway statement even
// when cancelling it through the signal fails. A statement stopped that way
// fails as the time budget's refusal (SearchBoundError, 408).
module(basename(import.meta.filename), function () {
  module('the deadline a signal carries', function () {
    test('a signal no budget armed has none', function (assert) {
      assert.strictEqual(
        signalDeadline(new AbortController().signal),
        undefined,
      );
      assert.strictEqual(signalDeadline(undefined), undefined);
    });

    test('a signal keeps the earliest deadline recorded for it', function (assert) {
      let signal = new AbortController().signal;
      setSignalDeadline(signal, 2_000);
      setSignalDeadline(signal, 5_000);
      assert.strictEqual(signalDeadline(signal), 2_000);
      setSignalDeadline(signal, 1_000);
      assert.strictEqual(signalDeadline(signal), 1_000);
    });

    test('a combined signal takes the earliest of its parts', function (assert) {
      let budget = new AbortController().signal;
      let realm = new AbortController().signal;
      let abandoned = new AbortController().signal;
      setSignalDeadline(budget, 9_000);
      setSignalDeadline(realm, 4_000);
      let merged = mergeAbortSignals(budget, abandoned)!;
      assert.strictEqual(signalDeadline(merged), 9_000, 'one armed part');
      assert.strictEqual(
        signalDeadline(mergeAbortSignals(merged, realm)),
        4_000,
        'the earlier of two',
      );
      assert.strictEqual(
        signalDeadline(mergeAbortSignals(abandoned, undefined)),
        undefined,
        'no armed part',
      );
    });

    test('the timeout is the time left plus the margin, never 0', function (assert) {
      assert.strictEqual(
        statementTimeoutFor(10_000, 4_000),
        6_000 + STATEMENT_TIMEOUT_MARGIN_MS,
      );
      assert.strictEqual(
        statementTimeoutFor(4_000, 10_000),
        1 + STATEMENT_TIMEOUT_MARGIN_MS,
        'a deadline already past still sets a timeout',
      );
      assert.strictEqual(
        statementTimeoutFor(4_000.2, 4_000),
        1 + STATEMENT_TIMEOUT_MARGIN_MS,
        'whole milliseconds',
      );
    });
  });

  module('PgAdapter.withReadSnapshot with a deadline', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    async function statementTimeout(reader: {
      execute: PgAdapter['execute'];
    }): Promise<string> {
      let [row] = (await reader.execute('SHOW statement_timeout')) as {
        statement_timeout: string;
      }[];
      return row.statement_timeout;
    }

    test("a snapshot sets the search's planner settings, and they end with it", async function (assert) {
      let show = async (reader: { execute: PgAdapter['execute'] }) => {
        let [jit] = (await reader.execute('SHOW jit_above_cost')) as {
          jit_above_cost: string;
        }[];
        let [mem] = (await reader.execute('SHOW work_mem')) as {
          work_mem: string;
        }[];
        return { jit: jit.jit_above_cost, mem: mem.work_mem };
      };
      let outside = await show(dbAdapter);
      let inside = await dbAdapter.withReadSnapshot(show);
      let { jitAboveCost, workMemKb } = searchSessionSettings();
      assert.strictEqual(Number(inside.jit), jitAboveCost, 'jit_above_cost');
      assert.strictEqual(inside.mem, `${workMemKb / 1024}MB`, 'work_mem');
      assert.deepEqual(
        await show(dbAdapter),
        outside,
        'the pool keeps its own',
      );
    });

    test('the settings come from the environment when it names them', function (assert) {
      let saved = {
        jit: process.env.PG_SEARCH_JIT_ABOVE_COST,
        mem: process.env.PG_SEARCH_WORK_MEM_KB,
        margin: process.env.PG_SEARCH_STATEMENT_TIMEOUT_MARGIN_MS,
      };
      try {
        delete process.env.PG_SEARCH_JIT_ABOVE_COST;
        delete process.env.PG_SEARCH_WORK_MEM_KB;
        assert.deepEqual(
          searchSessionSettings(),
          {
            jitAboveCost: SEARCH_JIT_ABOVE_COST,
            workMemKb: SEARCH_WORK_MEM_KB,
          },
          'the defaults',
        );
        process.env.PG_SEARCH_JIT_ABOVE_COST = '250000';
        process.env.PG_SEARCH_WORK_MEM_KB = '16384';
        process.env.PG_SEARCH_STATEMENT_TIMEOUT_MARGIN_MS = '2000';
        assert.deepEqual(searchSessionSettings(), {
          jitAboveCost: 250_000,
          workMemKb: 16_384,
        });
        assert.strictEqual(statementTimeoutFor(10_000, 4_000), 8_000);
        process.env.PG_SEARCH_WORK_MEM_KB = '8MB; DROP TABLE x';
        assert.strictEqual(
          searchSessionSettings().workMemKb,
          SEARCH_WORK_MEM_KB,
          'a value that is no whole number is ignored',
        );
      } finally {
        for (let [key, name] of [
          ['jit', 'PG_SEARCH_JIT_ABOVE_COST'],
          ['mem', 'PG_SEARCH_WORK_MEM_KB'],
          ['margin', 'PG_SEARCH_STATEMENT_TIMEOUT_MARGIN_MS'],
        ] as const) {
          if (saved[key] === undefined) delete process.env[name];
          else process.env[name] = saved[key];
        }
      }
    });

    test('without a deadline nothing is set', async function (assert) {
      let setting = await dbAdapter.withReadSnapshot(statementTimeout);
      assert.strictEqual(setting, '0', 'no statement timeout');
    });

    test('a deadline sets the time left plus the margin', async function (assert) {
      let setting = await dbAdapter.withReadSnapshot(statementTimeout, {
        deadline: Date.now() + 60_000,
      });
      let ms = /^(\d+)ms$/.exec(setting)?.[1];
      assert.ok(ms, `set in milliseconds; got ${setting}`);
      assert.ok(Number(ms) > 59_000, `about a minute; got ${setting}`);
      assert.ok(
        Number(ms) <= 60_000 + STATEMENT_TIMEOUT_MARGIN_MS,
        `no more than the time left and the margin; got ${setting}`,
      );
      assert.strictEqual(
        await statementTimeout(dbAdapter),
        '0',
        'it ends with the snapshot: the next statement on the pool has none',
      );
    });

    test('a statement that outruns the deadline is stopped by Postgres and refused as over budget', async function (assert) {
      let started = Date.now();
      let caught: unknown;
      try {
        // no signal: only the database can stop it
        await dbAdapter.withReadSnapshot(
          (reader) => reader.execute('SELECT pg_sleep(30)'),
          { deadline: Date.now() + 200 },
        );
      } catch (e) {
        caught = e;
      }
      assert.true(caught instanceof SearchBoundError, `refused: ${caught}`);
      assert.strictEqual((caught as SearchBoundError).status, 408);
      assert.ok(Date.now() - started < 10_000, 'it did not run to completion');
      let [row] = (await dbAdapter.execute('SELECT 1 AS one')) as {
        one: number;
      }[];
      assert.strictEqual(row.one, 1, 'the pool still serves statements');
    });

    test('the snapshot reads on after a statement it stopped', async function (assert) {
      let rows = await dbAdapter.withReadSnapshot(
        async (reader) => {
          await assert.rejects(
            reader.execute('SELECT pg_sleep(30)'),
            (e: unknown) => e instanceof SearchBoundError,
          );
          return await reader.execute('SELECT 2 AS two');
        },
        { deadline: Date.now() + 300 },
      );
      assert.deepEqual(rows, [{ two: 2 }]);
    });

    test('a statement within the deadline answers as without one', async function (assert) {
      let rows = await dbAdapter.withReadSnapshot(
        (reader) => reader.execute('SELECT 3 AS three'),
        { deadline: Date.now() + 60_000 },
      );
      assert.deepEqual(rows, [{ three: 3 }]);
    });

    test('an error other than the timeout is passed on as it was', async function (assert) {
      await assert.rejects(
        dbAdapter.withReadSnapshot((reader) => reader.execute('SELECT 1 / 0'), {
          deadline: Date.now() + 60_000,
        }),
        (e: any) => !(e instanceof SearchBoundError) && e?.code === '22012',
      );
    });
  });

  module('a search under a time budget', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    // the options each read snapshot was opened with
    function recording(seen: { deadline?: number }[]): DBAdapter {
      return new Proxy(dbAdapter, {
        get(target, key, receiver) {
          if (key === 'withReadSnapshot') {
            return (
              fn: (reader: DBAdapter) => Promise<unknown>,
              opts?: { signal?: AbortSignal; deadline?: number },
            ) => {
              seen.push({ ...(opts ?? {}) });
              return target.withReadSnapshot(fn, opts);
            };
          }
          return Reflect.get(target, key, receiver);
        },
      }) as unknown as DBAdapter;
    }
    const noDefinitions = {
      async lookupDefinition(): Promise<never> {
        throw new Error('no definitions are read');
      },
      async lookupDefinitionEntry(): Promise<never> {
        throw new Error('no definitions are read');
      },
      async lookupCachedDefinition() {
        return undefined;
      },
      async invalidate() {},
    } as unknown as DefinitionLookup;

    test('gives its read snapshot the deadline its signal carries', async function (assert) {
      let seen: { deadline?: number }[] = [];
      let engine = new IndexQueryEngine(
        recording(seen),
        noDefinitions,
        new VirtualNetwork(),
      );
      let controller = new AbortController();
      let deadline = Date.now() + 30_000;
      setSignalDeadline(controller.signal, deadline);
      await engine.search(
        new URL('http://statement-timeout/'),
        {},
        { signal: controller.signal },
        { kind: 'dataOnly' },
      );
      assert.ok(seen.length > 0, 'the search read a snapshot');
      assert.strictEqual(seen[0].deadline, deadline, 'with the deadline');
    });

    test('a search with no budget opens its snapshot with no deadline', async function (assert) {
      let seen: { deadline?: number }[] = [];
      let engine = new IndexQueryEngine(
        recording(seen),
        noDefinitions,
        new VirtualNetwork(),
      );
      await engine.search(
        new URL('http://statement-timeout/'),
        {},
        { signal: new AbortController().signal },
        { kind: 'dataOnly' },
      );
      assert.ok(seen.length > 0, 'the search read a snapshot');
      assert.strictEqual(seen[0].deadline, undefined);
    });
  });
});
