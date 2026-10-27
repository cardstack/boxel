import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import {
  logger,
  systemInitiatedPrerenderHtmlPriority,
} from '@cardstack/runtime-common';
import { REALM_HISTORY_RECOVERY_JOB_TIMEOUT_SEC } from '@cardstack/runtime-common/tasks/realm-history-recovery';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('realm-history-recovery');

// Enqueue the scheduled recovery sweep rather than running it in the
// worker-manager process: a worker visits each realm that records history and
// asks the realm-server serving it to check the realm against its history. At
// the background tier, so it never competes with indexing or user work.
export async function enqueueRealmHistoryRecovery({
  priority = systemInitiatedPrerenderHtmlPriority,
  migrateDB,
}: {
  priority?: number;
  migrateDB?: boolean;
} = {}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);

  try {
    await queue.publish({
      jobType: 'realm-history-recovery',
      concurrencyGroup: 'realm-history-recovery',
      timeout: REALM_HISTORY_RECOVERY_JOB_TIMEOUT_SEC,
      priority,
      args: {},
    });
    log.info('enqueued realm-history-recovery job');
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue realm-history-recovery job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
