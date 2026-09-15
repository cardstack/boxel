import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import { logger, systemInitiatedPriority } from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('lattice-clock-sweep');
const LATTICE_CLOCK_SWEEP_JOB_TIMEOUT_SEC = 5 * 60;

export async function enqueueLatticeClockSweep({
  priority = systemInitiatedPriority,
  migrateDB,
}: {
  priority?: number;
  migrateDB?: boolean;
} = {}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);
  try {
    // A busy queue (a long re-index ahead of the sweep) must not pile up one
    // sweep per tick: a pending sweep already covers everything expired by
    // the time it runs.
    let pending = await dbAdapter.execute(
      `SELECT 1 FROM jobs WHERE job_type = 'lattice-clock-sweep' AND status = 'unfulfilled' LIMIT 1`,
    );
    if (pending.length > 0) {
      log.info(
        'lattice-clock-sweep job already pending; not enqueuing another',
      );
      return;
    }
    await queue.publish({
      jobType: 'lattice-clock-sweep',
      concurrencyGroup: 'lattice-clock-sweep',
      timeout: LATTICE_CLOCK_SWEEP_JOB_TIMEOUT_SEC,
      priority,
      args: { limit: 0 },
    });
    log.info('enqueued lattice-clock-sweep job');
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue lattice-clock-sweep job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
