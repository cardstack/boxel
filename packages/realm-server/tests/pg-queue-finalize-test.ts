import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  attemptJobFinalize,
  finalizeJobVerdict,
  releaseJobReservation,
  FINALIZE_CONFLICT_RETRIES,
  type JobReservationsTable,
  type JobsTable,
  type PgAdapter,
} from '@cardstack/postgres';
import type { Expression, PgPrimitive } from '@cardstack/runtime-common';
import { createTestPgAdapter, prepareTestDB } from './helpers/index.ts';

const WORKER_ID = 'finalize-test-worker';

async function seedJobAndReservation(
  adapter: PgAdapter,
  opts: { leaseOffsetSeconds?: number } = {},
): Promise<{ job: JobsTable; reservationId: number }> {
  let [job] = (await adapter.execute(
    `INSERT INTO jobs (job_type, args, status, timeout)
     VALUES ('logJob', '{}'::jsonb, 'unfulfilled', 7200)
     RETURNING *`,
  )) as unknown as JobsTable[];
  let [reservation] = (await adapter.execute(
    `INSERT INTO job_reservations (job_id, worker_id, locked_until)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)
     RETURNING id`,
    { bind: [job.id, WORKER_ID, opts.leaseOffsetSeconds ?? 600] },
  )) as unknown as Pick<JobReservationsTable, 'id'>[];
  return { job, reservationId: reservation.id };
}

function firstSql(expression: Expression): string {
  let head = expression[0];
  return typeof head === 'string' ? head : '';
}

// Wrap a pinned-connection querier so that just before the finalize's own
// `UPDATE jobs`, a second connection commits a conflicting write to the same
// row. At SERIALIZABLE that makes the finalize's UPDATE the victim of a real
// `40001`, which is the only way to drive the retry path — including the
// ROLLBACK-then-BEGIN transaction handling — through actual Postgres rather
// than a stub.
function conflictInjectingQuerier(
  adapter: PgAdapter,
  query: (e: Expression) => Promise<Record<string, PgPrimitive>[]>,
  jobId: JobsTable['id'],
  conflictsToInject: number,
) {
  let injected = 0;
  let statements: string[] = [];
  let wrapped = async (expression: Expression) => {
    let sql = firstSql(expression);
    statements.push(sql.trim().split('\n')[0].trim());
    if (
      sql.startsWith('UPDATE jobs SET result=') &&
      injected < conflictsToInject
    ) {
      injected++;
      await adapter.execute(
        `UPDATE jobs SET timeout = timeout + 1 WHERE id = $1`,
        { bind: [jobId] },
      );
    }
    return await query(expression);
  };
  return {
    wrapped,
    statements,
    injectedCount: () => injected,
  };
}

module(basename(import.meta.filename), function () {
  module('job finalize', function (hooks) {
    let adapter: PgAdapter;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
    });

    hooks.afterEach(async function () {
      await adapter.close();
    });

    test('a serialization failure is reported as a retryable conflict, not a verdict', async function (assert) {
      let { job, reservationId } = await seedJobAndReservation(adapter);

      let outcome = await adapter.withConnection(async (query) => {
        let { wrapped, injectedCount } = conflictInjectingQuerier(
          adapter,
          query,
          job.id,
          1,
        );
        let result = await attemptJobFinalize(
          wrapped,
          job,
          reservationId,
          'resolved',
          { ok: true },
        );
        assert.strictEqual(injectedCount(), 1, 'a real conflict was injected');
        return result;
      });

      assert.strictEqual(
        outcome.type,
        'conflict',
        'SQLSTATE 40001 surfaces as a conflict rather than a superseded verdict',
      );

      let [row] = (await adapter.execute(
        `SELECT status FROM jobs WHERE id = $1`,
        { bind: [job.id] },
      )) as unknown as { status: string }[];
      assert.strictEqual(
        row.status,
        'unfulfilled',
        'the aborted transaction wrote nothing',
      );
    });

    test('retries a conflicted finalize and commits the verdict', async function (assert) {
      let { job, reservationId } = await seedJobAndReservation(adapter);

      let outcome = await adapter.withConnection(async (query) => {
        let { wrapped, statements } = conflictInjectingQuerier(
          adapter,
          query,
          job.id,
          1,
        );
        let result = await finalizeJobVerdict(
          wrapped,
          WORKER_ID,
          job,
          reservationId,
          'resolved',
          { ok: true },
        );
        // The conflicted attempt must roll back before the retry opens its own
        // transaction, or the retry's BEGIN would land inside an aborted one.
        assert.deepEqual(
          statements.filter((s) => ['BEGIN', 'ROLLBACK', 'COMMIT'].includes(s)),
          ['BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT'],
          'the conflicted attempt rolls back, then a fresh transaction commits',
        );
        assert.strictEqual(
          statements.filter((s) => s.startsWith('UPDATE jobs SET result='))
            .length,
          2,
          'the verdict write was attempted twice and no more',
        );
        return result;
      });

      assert.strictEqual(outcome.type, 'committed', 'the verdict was recorded');

      let [row] = (await adapter.execute(
        `SELECT status, result FROM jobs WHERE id = $1`,
        { bind: [job.id] },
      )) as unknown as {
        status: string;
        result: { ok?: boolean } | null;
      }[];
      assert.strictEqual(row.status, 'resolved', 'job resolved');
      assert.true(row.result?.ok, 'the handler result survived the retry');

      let [reservation] = (await adapter.execute(
        `SELECT completed_at, completion_reason FROM job_reservations WHERE id = $1`,
        { bind: [reservationId] },
      )) as unknown as {
        completed_at: Date | null;
        completion_reason: string | null;
      }[];
      assert.notEqual(reservation.completed_at, null, 'reservation closed');
      assert.strictEqual(
        reservation.completion_reason,
        'completed',
        'a retried-but-successful attempt still counts as a genuine attempt',
      );
    });

    test('exhausting the retries leaves the job claimable and releases the reservation', async function (assert) {
      let { job, reservationId } = await seedJobAndReservation(adapter);

      let { outcome, attempts } = await adapter.withConnection(
        async (query) => {
          // Conflict on every attempt, however many the retry budget allows.
          let { wrapped, statements, injectedCount } = conflictInjectingQuerier(
            adapter,
            query,
            job.id,
            Number.MAX_SAFE_INTEGER,
          );
          let result = await finalizeJobVerdict(
            wrapped,
            WORKER_ID,
            job,
            reservationId,
            'resolved',
            { ok: true },
          );
          assert.deepEqual(
            statements.filter((s) => ['BEGIN', 'COMMIT'].includes(s)),
            new Array(FINALIZE_CONFLICT_RETRIES + 1).fill('BEGIN'),
            'every attempt opened a transaction and none committed',
          );
          // The caller closes the reservation once the verdict is gone.
          await releaseJobReservation(
            wrapped,
            WORKER_ID,
            job.id,
            reservationId,
            result,
          );
          return { outcome: result, attempts: injectedCount() };
        },
      );

      assert.strictEqual(
        outcome.type,
        'conflict',
        'exhausted retries report a conflict, not a false verdict',
      );
      assert.strictEqual(
        attempts,
        FINALIZE_CONFLICT_RETRIES + 1,
        'the initial attempt plus the full retry budget',
      );

      let [row] = (await adapter.execute(
        `SELECT status FROM jobs WHERE id = $1`,
        { bind: [job.id] },
      )) as unknown as { status: string }[];
      assert.strictEqual(
        row.status,
        'unfulfilled',
        'the job goes back in the queue rather than being falsely decided',
      );

      let [reservation] = (await adapter.execute(
        `SELECT completed_at, completion_reason FROM job_reservations WHERE id = $1`,
        { bind: [reservationId] },
      )) as unknown as {
        completed_at: Date | null;
        completion_reason: string | null;
      }[];
      assert.notEqual(
        reservation.completed_at,
        null,
        'the reservation is closed, so its lease does not outlive the attempt',
      );
      assert.strictEqual(
        reservation.completion_reason,
        'interrupted',
        'the work succeeded and only its bookkeeping failed, so retrying is ' +
          'likely to record a verdict — this must not burn an attempt',
      );
    });

    test('a superseded verdict is not retried', async function (assert) {
      // Nothing about a decided job improves by trying again, and the retry
      // budget exists for contention, not for losing a race.
      let { job, reservationId } = await seedJobAndReservation(adapter);
      await adapter.execute(
        `UPDATE jobs SET status='rejected', finished_at=NOW() WHERE id = $1`,
        { bind: [job.id] },
      );

      let outcome = await adapter.withConnection(async (query) => {
        let { wrapped, statements } = conflictInjectingQuerier(
          adapter,
          query,
          job.id,
          0,
        );
        let result = await finalizeJobVerdict(
          wrapped,
          WORKER_ID,
          job,
          reservationId,
          'resolved',
          { ok: true },
        );
        assert.deepEqual(
          statements.filter((s) => s === 'BEGIN'),
          ['BEGIN'],
          'exactly one attempt was made',
        );
        return result;
      });

      assert.strictEqual(outcome.type, 'superseded', 'reported as superseded');
      assert.strictEqual(
        (outcome as { cause?: string }).cause,
        'the job already has a recorded outcome',
        'and names why the verdict was dropped',
      );
    });
  });
});
