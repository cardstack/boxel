import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type {
  JobReservationsTable,
  JobsTable,
  PgAdapter,
} from '@cardstack/postgres';
import { findStuckReservations } from '../lib/stuck-reservations.ts';
import { createTestPgAdapter, prepareTestDB } from './helpers/index.ts';

async function insertJob(adapter: PgAdapter): Promise<JobsTable['id']> {
  let rows = (await adapter.execute(
    `INSERT INTO jobs (job_type, args, status, timeout)
     VALUES ('from-scratch-index', '{}'::jsonb, 'unfulfilled', 7200)
     RETURNING id`,
  )) as unknown as Pick<JobsTable, 'id'>[];
  return rows[0].id;
}

async function insertReservation(
  adapter: PgAdapter,
  jobId: JobsTable['id'],
  workerId: string,
  opts: {
    // Seconds relative to now; negative means the lease has already lapsed.
    leaseOffsetSeconds: number;
    closed?: boolean;
  },
): Promise<JobReservationsTable['id']> {
  let rows = (await adapter.execute(
    `INSERT INTO job_reservations
       (job_id, worker_id, locked_until, completed_at, completion_reason)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval,
       CASE WHEN $4 THEN NOW() ELSE NULL END,
       CASE WHEN $4 THEN 'completed' ELSE NULL END)
     RETURNING id`,
    {
      bind: [jobId, workerId, opts.leaseOffsetSeconds, opts.closed ?? false],
    },
  )) as unknown as Pick<JobReservationsTable, 'id'>[];
  return rows[0].id;
}

module(basename(import.meta.filename), function () {
  module('findStuckReservations', function (hooks) {
    let adapter: PgAdapter;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
    });

    hooks.afterEach(async function () {
      await adapter.close();
    });

    test('reports an open reservation whose lease has lapsed past the grace period', async function (assert) {
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(adapter, jobId, 'worker-a', {
        leaseOffsetSeconds: -60,
      });

      let stuck = await findStuckReservations(adapter, 'worker-a');

      assert.strictEqual(stuck.length, 1, 'one stuck reservation');
      assert.strictEqual(stuck[0].id, String(reservationId));
      assert.strictEqual(stuck[0].jobId, String(jobId));
    });

    test('ignores a reservation still inside its lease or its grace period', async function (assert) {
      let liveJob = await insertJob(adapter);
      await insertReservation(adapter, liveJob, 'worker-b', {
        leaseOffsetSeconds: 600,
      });
      // Lapsed, but only just — a job that runs to the edge of its lease can
      // still be mid-COMMIT, so the grace period must exclude it.
      let recentJob = await insertJob(adapter);
      await insertReservation(adapter, recentJob, 'worker-b', {
        leaseOffsetSeconds: -5,
      });

      let stuck = await findStuckReservations(adapter, 'worker-b');

      assert.deepEqual(stuck, [], 'neither reservation is reported');
    });

    test('ignores a reservation that already closed', async function (assert) {
      let jobId = await insertJob(adapter);
      await insertReservation(adapter, jobId, 'worker-c', {
        leaseOffsetSeconds: -60,
        closed: true,
      });

      let stuck = await findStuckReservations(adapter, 'worker-c');

      assert.deepEqual(stuck, [], 'a closed reservation is not stuck');
    });

    test('ignores a reservation the same worker has already superseded', async function (assert) {
      let jobId = await insertJob(adapter);
      await insertReservation(adapter, jobId, 'worker-d', {
        leaseOffsetSeconds: -600,
      });
      await insertReservation(adapter, jobId, 'worker-d', {
        leaseOffsetSeconds: -60,
      });

      let stuck = await findStuckReservations(adapter, 'worker-d');

      assert.strictEqual(
        stuck.length,
        1,
        'only the newest of the worker’s own attempts is reported',
      );
    });

    test('reports an orphan even when another worker now holds the job', async function (assert) {
      // Recycling the child and deciding the job's outcome are separate
      // questions. This row means the child never returned from its handler,
      // which is true regardless of who holds the job now — so it is reported,
      // and `markFailedJob` settles ownership when it writes the outcome.
      let jobId = await insertJob(adapter);
      await insertReservation(adapter, jobId, 'worker-e', {
        leaseOffsetSeconds: -60,
      });
      await insertReservation(adapter, jobId, 'worker-f', {
        leaseOffsetSeconds: 600,
      });

      let stuck = await findStuckReservations(adapter, 'worker-e');

      assert.strictEqual(stuck.length, 1, 'the orphan is reported');
      assert.strictEqual(stuck[0].jobId, String(jobId));
    });

    test('reports nothing for a worker with no reservations', async function (assert) {
      let jobId = await insertJob(adapter);
      await insertReservation(adapter, jobId, 'someone-else', {
        leaseOffsetSeconds: -600,
      });

      let stuck = await findStuckReservations(adapter, 'worker-h');

      assert.deepEqual(stuck, [], 'another worker’s orphan is not reported');
    });
  });
});
