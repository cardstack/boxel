import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import { automationInitiatedPriority, logger } from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('automation-tick');
const AUTOMATION_TICK_JOB_TIMEOUT_SEC = 5 * 60;

// Enqueues one tick at the automation tier, so the automation worker lane
// claims it and a system-tier backlog can't hold back scheduled runs.
export async function enqueueAutomationTick({
  migrateDB,
}: {
  migrateDB?: boolean;
} = {}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);

  try {
    await queue.publish({
      jobType: 'automation-tick',
      concurrencyGroup: 'automation-tick',
      timeout: AUTOMATION_TICK_JOB_TIMEOUT_SEC,
      priority: automationInitiatedPriority,
      args: {},
    });
    log.debug('enqueued automation-tick job');
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue automation-tick job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
