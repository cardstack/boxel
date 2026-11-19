import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import {
  logger,
  systemInitiatedPrerenderHtmlPriority,
} from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('oauth-provider-cleanup');
const OAUTH_PROVIDER_CLEANUP_JOB_TIMEOUT_SEC = 10 * 60;

// Enqueues the OAuth provider's daily cleanup, which a worker runs
// (`lib/oauth-provider/cleanup.ts`). It runs at the background tier, as the
// media-cache GC does, so it never competes with indexing or user work.
export async function enqueueOAuthProviderCleanup({
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
      jobType: 'oauth-provider-cleanup',
      concurrencyGroup: 'oauth-provider-cleanup',
      timeout: OAUTH_PROVIDER_CLEANUP_JOB_TIMEOUT_SEC,
      priority,
      args: {},
    });
    log.info('enqueued oauth-provider-cleanup job');
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue oauth-provider-cleanup job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
