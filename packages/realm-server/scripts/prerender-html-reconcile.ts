import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import {
  logger,
  systemInitiatedPrerenderHtmlPriority,
} from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('prerender-html-reconcile');
const PRERENDER_HTML_RECONCILE_JOB_TIMEOUT_SEC = 10 * 60;

// Enqueue the reconciliation scan rather than scanning inline in the
// worker-manager process: a worker runs the DB scan and enqueues per-realm
// prerender_html repairs. The scan runs at the background tier (priority 0) so
// it never competes with indexing or user work — it only runs when the
// all-priority pool is otherwise idle.
export async function enqueuePrerenderHtmlReconcile({
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
      jobType: 'prerender-html-reconcile',
      concurrencyGroup: 'prerender-html-reconcile',
      timeout: PRERENDER_HTML_RECONCILE_JOB_TIMEOUT_SEC,
      priority,
      args: {},
    });
    log.info('enqueued prerender-html-reconcile job');
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue prerender-html-reconcile job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
