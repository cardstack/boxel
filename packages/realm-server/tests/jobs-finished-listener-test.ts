import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { query, param } from '@cardstack/runtime-common';
import { setupDB } from './helpers';
import { JobsFinishedListener } from '../lib/jobs-finished-listener';

// Minimal stand-in for JobScopedSearchCache exposing only the surface the
// listener touches: the set of `<jobId>.<reservationId>` keys it holds and a
// clearJob that removes one.
class FakeSearchCache {
  #keys: Set<string>;
  constructor(keys: string[] = []) {
    this.#keys = new Set(keys);
  }
  // Async to match the DB-backed JobScopedSearchCache surface the listener
  // awaits.
  async jobIds(): Promise<string[]> {
    return [...this.#keys];
  }
  async clearJob(jobId: string): Promise<void> {
    this.#keys.delete(jobId);
  }
  // Synchronous snapshot for assertions.
  current(): string[] {
    return [...this.#keys];
  }
}

function waitFor<T>(
  getValue: () => T | undefined,
  timeoutMs = 3000,
  pollMs = 20,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const value = getValue();
      if (value !== undefined) {
        resolve(value);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timeout after ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

module(basename(__filename), function () {
  module('JobsFinishedListener (sweep dispatch)', function () {
    test('clears every cached key whose job has finalized', async function (assert) {
      let cache = new FakeSearchCache(['5.1', '9.1']);
      let listener = new JobsFinishedListener({
        dbAdapter: {} as unknown as PgAdapter,
        searchCache: cache,
        // 5 finalized, 9 still running.
        fetchFinalizedJobIds: async () => new Set([5]),
      });

      await listener.handleNotification();

      assert.deepEqual(
        cache.current().sort(),
        ['9.1'],
        'the finalized job entry is cleared; the running job entry is kept',
      );
    });

    test('clears every reservation of a finalized job', async function (assert) {
      let cache = new FakeSearchCache(['5.1', '5.2', '5.3']);
      let listener = new JobsFinishedListener({
        dbAdapter: {} as unknown as PgAdapter,
        searchCache: cache,
        fetchFinalizedJobIds: async () => new Set([5]),
      });

      await listener.handleNotification();

      assert.deepEqual(
        cache.current(),
        [],
        'all reservations of the finalized job are cleared',
      );
    });

    test('passes the distinct numeric job ids parsed from cache keys', async function (assert) {
      let seen: number[] | undefined;
      let cache = new FakeSearchCache(['12.3', '12.4', '7.1']);
      let listener = new JobsFinishedListener({
        dbAdapter: {} as unknown as PgAdapter,
        searchCache: cache,
        fetchFinalizedJobIds: async (ids) => {
          seen = [...ids].sort((a, b) => a - b);
          return new Set();
        },
      });

      await listener.handleNotification();

      assert.deepEqual(
        seen,
        [7, 12],
        'the `<jobId>.<reservationId>` keys collapse to distinct numeric job ids',
      );
    });

    test('skips malformed keys without querying them', async function (assert) {
      let seen: number[] | undefined;
      let cache = new FakeSearchCache(['not-a-number', '5.1']);
      let listener = new JobsFinishedListener({
        dbAdapter: {} as unknown as PgAdapter,
        searchCache: cache,
        fetchFinalizedJobIds: async (ids) => {
          seen = [...ids];
          return new Set([5]);
        },
      });

      await listener.handleNotification();

      assert.deepEqual(
        seen,
        [5],
        'only the well-formed key contributes a job id',
      );
      assert.deepEqual(
        cache.current(),
        ['not-a-number'],
        'the finalized entry is cleared; the malformed key is left untouched',
      );
    });

    test('no-ops on an empty cache without querying', async function (assert) {
      let fetchCalls = 0;
      let cache = new FakeSearchCache([]);
      let listener = new JobsFinishedListener({
        dbAdapter: {} as unknown as PgAdapter,
        searchCache: cache,
        fetchFinalizedJobIds: async () => {
          fetchCalls++;
          return new Set();
        },
      });

      await listener.handleNotification();

      assert.strictEqual(
        fetchCalls,
        0,
        'no DB query when there is nothing cached',
      );
    });

    test('swallows fetch errors (best-effort)', async function (assert) {
      let cache = new FakeSearchCache(['5.1']);
      let listener = new JobsFinishedListener({
        dbAdapter: {} as unknown as PgAdapter,
        searchCache: cache,
        fetchFinalizedJobIds: async () => {
          throw new Error('boom');
        },
      });

      await listener.handleNotification();

      assert.deepEqual(
        cache.current(),
        ['5.1'],
        'a failed sweep leaves the cache intact (entries fall back to TTL)',
      );
    });

    test('coalesces a burst of notifications into one in-flight sweep + one re-run', async function (assert) {
      let calls = 0;
      let release!: () => void;
      let gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let cache = new FakeSearchCache(['5.1']);
      let listener = new JobsFinishedListener({
        dbAdapter: {} as unknown as PgAdapter,
        searchCache: cache,
        fetchFinalizedJobIds: async () => {
          calls++;
          // Hold the first sweep open so the next notifications land while it
          // is still in flight.
          if (calls === 1) {
            await gate;
          }
          return new Set();
        },
      });

      let first = listener.handleNotification(); // starts the sweep, awaits gate
      await listener.handleNotification(); // arrives mid-sweep → queued
      await listener.handleNotification(); // also mid-sweep → still just queued
      release();
      await first;

      assert.strictEqual(
        calls,
        2,
        'the burst collapses to the in-flight sweep plus a single re-run',
      );
    });
  });

  module('JobsFinishedListener (DB-backed sweep)', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    async function insertJob(status: string): Promise<number> {
      let rows = (await query(dbAdapter, [
        `INSERT INTO jobs (job_type, status) VALUES (`,
        param('from-scratch-index'),
        `,`,
        param(status),
        `) RETURNING id`,
      ])) as { id: number | string }[];
      return Number(rows[0].id);
    }

    test('queries jobs and clears entries for resolved + rejected jobs only', async function (assert) {
      let resolvedId = await insertJob('resolved');
      let rejectedId = await insertJob('rejected');
      let runningId = await insertJob('unfulfilled');

      let cache = new FakeSearchCache([
        `${resolvedId}.1`,
        `${rejectedId}.1`,
        `${runningId}.1`,
      ]);
      // No fetch override: exercises the real `jobs` query.
      let listener = new JobsFinishedListener({
        dbAdapter,
        searchCache: cache,
      });

      await listener.handleNotification();

      assert.deepEqual(
        cache.current(),
        [`${runningId}.1`],
        'resolved and rejected jobs are evicted; the unfulfilled job is kept',
      );
    });

    test('NOTIFY jobs_finished drives the sweep end-to-end', async function (assert) {
      let resolvedId = await insertJob('resolved');
      let cache = new FakeSearchCache([`${resolvedId}.1`]);
      let listener = new JobsFinishedListener({
        dbAdapter,
        searchCache: cache,
      });
      await listener.start();
      try {
        await dbAdapter.notify('jobs_finished', '');
        await waitFor(() => (cache.current().length === 0 ? true : undefined));
        assert.deepEqual(
          cache.current(),
          [],
          'the finalized job entry was evicted in response to the NOTIFY',
        );
      } finally {
        await listener.shutDown();
      }
    });
  });
});
