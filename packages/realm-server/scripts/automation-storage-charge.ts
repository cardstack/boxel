import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import {
  automationInitiatedPriority,
  logger,
  previousUTCDay,
} from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('automation-storage-charge');
const AUTOMATION_STORAGE_CHARGE_JOB_TIMEOUT_SEC = 30 * 60;

// Enqueues the charge for the most recent UTC day that has ended. The job
// runs at the automation tier, which the automation worker lane claims, so
// a system-tier reindex backlog doesn't hold it. Every worker manager fires
// the cron; the duplicate jobs find each charge already made.
export async function enqueueAutomationStorageCharge({
  day = previousUTCDay(),
  migrateDB,
}: {
  day?: string;
  migrateDB?: boolean;
} = {}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);

  try {
    await queue.publish({
      jobType: 'automation-storage-charge',
      concurrencyGroup: 'automation-storage-charge',
      timeout: AUTOMATION_STORAGE_CHARGE_JOB_TIMEOUT_SEC,
      priority: automationInitiatedPriority,
      args: { day },
    });
    log.info(`enqueued automation-storage-charge job for ${day}`);
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue automation-storage-charge job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
