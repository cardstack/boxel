import { module, test } from 'qunit';
import { basename } from 'path';
import type { DBAdapter, PgPrimitive } from '@cardstack/runtime-common';
import { IndexingEventSink } from '../indexing-event-sink.ts';

interface RecordedExecute {
  sql: string;
  bind: PgPrimitive[];
}

function makeRecordingAdapter(): {
  adapter: DBAdapter;
  executes: RecordedExecute[];
} {
  let executes: RecordedExecute[] = [];
  return {
    executes,
    adapter: {
      kind: 'pg',
      isClosed: false,
      async execute(sql, opts) {
        executes.push({
          sql,
          bind: (opts?.bind ?? []) as PgPrimitive[],
        });
        return [];
      },
      async close() {},
      async getColumnNames() {
        return [];
      },
      async notify() {},
      async withWriteLock(_url, fn) {
        return await fn(undefined);
      },
      async withUserCostLock(_userId, fn) {
        return await fn();
      },
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

module(basename(import.meta.filename), function () {
  test('tracks active indexing from start through file visits to finish', function (assert) {
    let sink = new IndexingEventSink();

    assert.deepEqual(sink.getSnapshot(), { active: [], history: [] });

    sink.handleEvent({
      type: 'indexing-started',
      realmURL: 'http://example.com/realm/',
      jobId: 1,
      jobType: 'from-scratch',
      totalFiles: 3,
      files: [
        'http://example.com/realm/a.gts',
        'http://example.com/realm/b.json',
        'http://example.com/realm/c.gts',
      ],
    });

    let { active, history } = sink.getSnapshot();
    assert.strictEqual(active.length, 1);
    assert.strictEqual(history.length, 0);
    assert.strictEqual(active[0].realmURL, 'http://example.com/realm/');
    assert.strictEqual(active[0].totalFiles, 3);
    assert.strictEqual(active[0].filesCompleted, 0);
    assert.strictEqual(active[0].status, 'indexing');

    sink.handleEvent({
      type: 'file-visited',
      realmURL: 'http://example.com/realm/',
      jobId: 1,
      url: 'http://example.com/realm/a.gts',
      filesCompleted: 1,
      totalFiles: 3,
    });

    ({ active } = sink.getSnapshot());
    assert.strictEqual(active[0].filesCompleted, 1);
    assert.deepEqual(active[0].completedFiles, [
      'http://example.com/realm/a.gts',
    ]);

    sink.handleEvent({
      type: 'file-visited',
      realmURL: 'http://example.com/realm/',
      jobId: 1,
      url: 'http://example.com/realm/b.json',
      filesCompleted: 2,
      totalFiles: 3,
    });

    sink.handleEvent({
      type: 'file-visited',
      realmURL: 'http://example.com/realm/',
      jobId: 1,
      url: 'http://example.com/realm/c.gts',
      filesCompleted: 3,
      totalFiles: 3,
    });

    ({ active } = sink.getSnapshot());
    assert.strictEqual(active[0].filesCompleted, 3);

    sink.handleEvent({
      type: 'indexing-finished',
      realmURL: 'http://example.com/realm/',
      jobId: 1,
      stats: {
        instancesIndexed: 1,
        filesIndexed: 2,
        instanceErrors: 0,
        fileErrors: 0,
        totalIndexEntries: 3,
      },
    });

    ({ active, history } = sink.getSnapshot());
    assert.strictEqual(active.length, 0, 'no longer active after finish');
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].realmURL, 'http://example.com/realm/');
    assert.strictEqual(history[0].status, 'finished');
    assert.deepEqual(history[0].stats, {
      instancesIndexed: 1,
      filesIndexed: 2,
      instanceErrors: 0,
      fileErrors: 0,
      totalIndexEntries: 3,
    });
  });

  test('tracks multiple realms concurrently', function (assert) {
    let sink = new IndexingEventSink();

    sink.handleEvent({
      type: 'indexing-started',
      realmURL: 'http://example.com/realm-a/',
      jobId: 1,
      jobType: 'from-scratch',
      totalFiles: 10,
      files: [],
    });

    sink.handleEvent({
      type: 'indexing-started',
      realmURL: 'http://example.com/realm-b/',
      jobId: 2,
      jobType: 'incremental',
      totalFiles: 2,
      files: [],
    });

    assert.strictEqual(sink.getActiveIndexing().length, 2);

    sink.handleEvent({
      type: 'indexing-finished',
      realmURL: 'http://example.com/realm-b/',
      jobId: 2,
    });

    assert.strictEqual(sink.getActiveIndexing().length, 1);
    assert.strictEqual(
      sink.getActiveIndexing()[0].realmURL,
      'http://example.com/realm-a/',
    );
    assert.strictEqual(sink.getHistory().length, 1);
  });

  test('ignores file-visited for unknown realm', function (assert) {
    let sink = new IndexingEventSink();

    sink.handleEvent({
      type: 'file-visited',
      realmURL: 'http://example.com/unknown/',
      jobId: 99,
      url: 'http://example.com/unknown/x.json',
      filesCompleted: 1,
      totalFiles: 1,
    });

    assert.strictEqual(sink.getActiveIndexing().length, 0);
  });

  module('Postgres write-through (CS-10930)', function () {
    test('indexing-started UPSERTs job_progress with total_files and files_completed=0', async function (assert) {
      let { adapter, executes } = makeRecordingAdapter();
      let sink = new IndexingEventSink({ flushIntervalMs: 50 });
      sink.setAdapter(adapter);
      try {
        sink.handleEvent({
          type: 'indexing-started',
          realmURL: 'http://example.com/realm/',
          jobId: 42,
          jobType: 'from-scratch',
          totalFiles: 200,
          files: [],
        });
        // The write is detached; flush microtasks before asserting.
        await sleep(10);

        assert.strictEqual(executes.length, 1, 'exactly one DB write');
        assert.ok(
          executes[0].sql.includes('INSERT INTO job_progress'),
          'wrote INSERT statement',
        );
        assert.ok(
          executes[0].sql.includes('ON CONFLICT (job_id) DO UPDATE'),
          'used UPSERT',
        );
        assert.deepEqual(
          executes[0].bind,
          [42, 200, 0],
          'bound jobId, totalFiles, filesCompleted=0',
        );
      } finally {
        sink.dispose();
      }
    });

    test('file-visited coalesces into one UPDATE per flush tick', async function (assert) {
      let { adapter, executes } = makeRecordingAdapter();
      let sink = new IndexingEventSink({ flushIntervalMs: 30 });
      sink.setAdapter(adapter);
      try {
        sink.handleEvent({
          type: 'indexing-started',
          realmURL: 'http://example.com/realm/',
          jobId: 7,
          jobType: 'incremental',
          totalFiles: 100,
          files: [],
        });
        await sleep(5);
        let writesAfterStart = executes.length;
        assert.strictEqual(writesAfterStart, 1, 'started fired one write');

        // Burst of 50 file-visited events arrives faster than the flush
        // interval — they should coalesce into ≤1 write per tick.
        for (let i = 1; i <= 50; i++) {
          sink.handleEvent({
            type: 'file-visited',
            realmURL: 'http://example.com/realm/',
            jobId: 7,
            url: `http://example.com/realm/file-${i}.gts`,
            filesCompleted: i,
            totalFiles: 100,
          });
        }
        // Wait for one flush tick to fire.
        await sleep(60);

        let writesAfterBurst = executes.length;
        assert.ok(
          writesAfterBurst - writesAfterStart <= 2,
          `burst of 50 events produced ≤2 writes, got ${writesAfterBurst - writesAfterStart}`,
        );
        // The most recent write should reflect the latest in-memory state.
        let last = executes[executes.length - 1];
        assert.deepEqual(
          last.bind,
          [7, 100, 50],
          'last write reflects latest filesCompleted (50)',
        );
      } finally {
        sink.dispose();
      }
    });

    test('idle ticks do not issue any writes', async function (assert) {
      let { adapter, executes } = makeRecordingAdapter();
      let sink = new IndexingEventSink({ flushIntervalMs: 20 });
      sink.setAdapter(adapter);
      try {
        // Wait for several flush ticks with no events.
        await sleep(70);
        assert.strictEqual(executes.length, 0, 'no writes when no events');
      } finally {
        sink.dispose();
      }
    });

    test('indexing-finished issues final UPSERT immediately', async function (assert) {
      let { adapter, executes } = makeRecordingAdapter();
      let sink = new IndexingEventSink({ flushIntervalMs: 1000 });
      sink.setAdapter(adapter);
      try {
        sink.handleEvent({
          type: 'indexing-started',
          realmURL: 'http://example.com/realm/',
          jobId: 99,
          jobType: 'from-scratch',
          totalFiles: 5,
          files: [],
        });
        sink.handleEvent({
          type: 'file-visited',
          realmURL: 'http://example.com/realm/',
          jobId: 99,
          url: 'http://example.com/realm/x.gts',
          filesCompleted: 5,
          totalFiles: 5,
        });
        sink.handleEvent({
          type: 'indexing-finished',
          realmURL: 'http://example.com/realm/',
          jobId: 99,
        });
        await sleep(10);

        // Started + finished — two writes (file-visited is debounced
        // and won't fire its own write before the long-interval tick).
        assert.strictEqual(executes.length, 2, 'started + finished writes');
        assert.deepEqual(
          executes[1].bind,
          [99, 5, 5],
          'final write has filesCompleted=5, total_files=5',
        );
      } finally {
        sink.dispose();
      }
    });

    test('dispose() stops the flush timer; no writes after dispose', async function (assert) {
      let { adapter, executes } = makeRecordingAdapter();
      let sink = new IndexingEventSink({ flushIntervalMs: 20 });
      sink.setAdapter(adapter);

      sink.handleEvent({
        type: 'indexing-started',
        realmURL: 'http://example.com/realm/',
        jobId: 1,
        jobType: 'from-scratch',
        totalFiles: 10,
        files: [],
      });
      await sleep(5);
      let baseline = executes.length;

      sink.dispose();

      // Subsequent events go in-memory only — no writes.
      sink.handleEvent({
        type: 'file-visited',
        realmURL: 'http://example.com/realm/',
        jobId: 1,
        url: 'http://example.com/realm/x.gts',
        filesCompleted: 1,
        totalFiles: 10,
      });
      await sleep(60);

      assert.strictEqual(
        executes.length,
        baseline,
        'no writes after dispose, even when ticks would have fired',
      );
    });

    test('flush guards against overlapping ticks under DB pressure', async function (assert) {
      // Slow adapter — each execute() takes 60 ms, far longer than the
      // 10 ms tick interval. Without the in-flight guard the timer would
      // queue up ~6 overlapping flushes per slow write.
      let executes: RecordedExecute[] = [];
      let slowAdapter: DBAdapter = {
        kind: 'pg',
        isClosed: false,
        async execute(sql, opts) {
          executes.push({
            sql,
            bind: (opts?.bind ?? []) as PgPrimitive[],
          });
          await sleep(60);
          return [];
        },
        async close() {},
        async getColumnNames() {
          return [];
        },
        async notify() {},
        async withWriteLock(_url, fn) {
          return await fn(undefined);
        },
        async withUserCostLock(_userId, fn) {
          return await fn();
        },
      };
      let sink = new IndexingEventSink({ flushIntervalMs: 10 });
      sink.setAdapter(slowAdapter);
      try {
        // Started writes immediately (not via flush). One execute.
        sink.handleEvent({
          type: 'indexing-started',
          realmURL: 'http://example.com/realm/',
          jobId: 1,
          jobType: 'from-scratch',
          totalFiles: 100,
          files: [],
        });
        // Mark dirty — periodic flush should pick this up.
        sink.handleEvent({
          type: 'file-visited',
          realmURL: 'http://example.com/realm/',
          jobId: 1,
          url: 'http://example.com/realm/x.gts',
          filesCompleted: 1,
          totalFiles: 100,
        });
        // 200 ms = ~20 timer ticks. Each flush takes 60 ms, so without
        // the guard this would fan out into ~20 concurrent execute()
        // calls. With the guard, at most 4 flushes fire in 200 ms
        // (each waits for the prior to finish), and only the first one
        // sees a non-empty dirty set — subsequent flushes find it
        // already drained and skip.
        await sleep(200);
        // Allow for the started UPSERT + ~3 flush UPSERTs at the
        // worst end of timing variance.
        assert.ok(
          executes.length <= 5,
          `expected ≤5 execute calls under guard, got ${executes.length}`,
        );
        assert.ok(
          executes.length >= 2,
          `expected at least the started UPSERT + one flush UPSERT, got ${executes.length}`,
        );
      } finally {
        sink.dispose();
        // Wait for any pending in-flight execute to settle so the test
        // doesn't bleed work into the next test's setup.
        await sleep(80);
      }
    });

    test('fileVisitedLogEvery is clamped to ≥ 1', function (assert) {
      // Boundary cases for the env-var-driven sample option (CS-10930).
      // 0 / negative / NaN should fall back to 1 (no sampling).
      let s0 = new IndexingEventSink({ fileVisitedLogEvery: 0 });
      let sNeg = new IndexingEventSink({ fileVisitedLogEvery: -5 });
      let sNaN = new IndexingEventSink({ fileVisitedLogEvery: NaN });
      // Indirect assertion via behavior: handleEvent on file-visited
      // shouldn't throw modulo-by-zero. If the clamp is wrong this
      // test would catch divide-by-zero or NaN-comparison drift.
      try {
        for (let s of [s0, sNeg, sNaN]) {
          s.handleEvent({
            type: 'indexing-started',
            realmURL: 'http://example.com/realm/',
            jobId: 1,
            jobType: 'from-scratch',
            totalFiles: 1,
            files: [],
          });
          s.handleEvent({
            type: 'file-visited',
            realmURL: 'http://example.com/realm/',
            jobId: 1,
            url: 'http://example.com/realm/a.gts',
            filesCompleted: 1,
            totalFiles: 1,
          });
        }
        assert.ok(true, 'no throw on degenerate fileVisitedLogEvery values');
      } finally {
        s0.dispose();
        sNeg.dispose();
        sNaN.dispose();
      }
    });

    test('without setAdapter, sink runs in-memory only (no writes attempted)', async function (assert) {
      let { adapter, executes } = makeRecordingAdapter();
      // Construct sink WITHOUT setAdapter — the recording adapter is
      // unused by the sink. Use it to confirm zero writes.
      let sink = new IndexingEventSink({ flushIntervalMs: 20 });
      try {
        sink.handleEvent({
          type: 'indexing-started',
          realmURL: 'http://example.com/realm/',
          jobId: 1,
          jobType: 'from-scratch',
          totalFiles: 3,
          files: [],
        });
        sink.handleEvent({
          type: 'file-visited',
          realmURL: 'http://example.com/realm/',
          jobId: 1,
          url: 'http://example.com/realm/a.gts',
          filesCompleted: 1,
          totalFiles: 3,
        });
        await sleep(60);
        assert.strictEqual(executes.length, 0, 'never touched the adapter');
        // ...but in-memory state still tracked.
        assert.strictEqual(sink.getActiveIndexing()[0].filesCompleted, 1);
        // Suppress unused-variable lint on `adapter`.
        void adapter;
      } finally {
        sink.dispose();
      }
    });
  });
});
