import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import { automationInitiatedPriority, logger } from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('automation-reconcile');
const AUTOMATION_RECONCILE_JOB_TIMEOUT_SEC = 5 * 60;

// Enqueues one reconcile pass at the automation tier, so the automation
// worker lane claims it beside the tick.
export async function enqueueAutomationReconcile({
  migrateDB,
}: {
  migrateDB?: boolean;
} = {}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);

  try {
    await queue.publish({
      jobType: 'automation-reconcile',
      concurrencyGroup: 'automation-reconcile',
      timeout: AUTOMATION_RECONCILE_JOB_TIMEOUT_SEC,
      priority: automationInitiatedPriority,
      args: {},
    });
    log.debug('enqueued automation-reconcile job');
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue automation-reconcile job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
