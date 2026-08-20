import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import { logger, systemInitiatedPriority } from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('media-cache-gc');
const MEDIA_CACHE_GC_JOB_TIMEOUT_SEC = 10 * 60;

// Enqueue the GC sweep rather than sweeping inline in the worker-manager
// process: a worker scans the ledger and deletes reclaimed rows/objects. The
// sweep runs at the background tier (priority 0) so it never competes with
// indexing or user work.
export async function enqueueMediaCacheGc({
  priority = systemInitiatedPriority,
  migrateDB,
}: {
  priority?: number;
  migrateDB?: boolean;
} = {}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);

  try {
    await queue.publish({
      jobType: 'media-cache-gc',
      concurrencyGroup: 'media-cache-gc',
      timeout: MEDIA_CACHE_GC_JOB_TIMEOUT_SEC,
      priority,
      args: {},
    });
    log.info('enqueued media-cache-gc job');
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue media-cache-gc job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
