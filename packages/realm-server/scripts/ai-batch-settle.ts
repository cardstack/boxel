import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import { logger, systemInitiatedPriority } from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('ai-batch-settle');
const AI_BATCH_SETTLE_JOB_TIMEOUT_SEC = 10 * 60;

// Enqueues one settle pass at the system tier. A backlog only delays it: a
// batch's cost reads as pending a little longer, and the pass bills whatever
// has ended when it runs.
export async function enqueueAIBatchSettle({
  migrateDB,
}: {
  migrateDB?: boolean;
} = {}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);

  try {
    await queue.publish({
      jobType: 'ai-batch-settle',
      concurrencyGroup: 'ai-batch-settle',
      timeout: AI_BATCH_SETTLE_JOB_TIMEOUT_SEC,
      priority: systemInitiatedPriority,
      args: {},
    });
    log.debug('enqueued ai-batch-settle job');
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue ai-batch-settle job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
