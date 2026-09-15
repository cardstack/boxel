import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import {
  logger,
  systemInitiatedPrerenderHtmlPriority,
} from '@cardstack/runtime-common';
import { indexingConcurrencyGroup } from '@cardstack/runtime-common/jobs/indexing';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('scoped-css-gc');
const SCOPED_CSS_GC_JOB_TIMEOUT_SEC = 10 * 60;

// Fan the sweep out as one queue job per realm that holds `scoped_css` rows,
// rather than one system-wide job: each job runs in its realm's indexing
// concurrency group, which is what serializes the sweep against that realm's
// index passes (see `sweepUnreferencedScopedCSS`). Background tier
// (priority 0, the all-priority pool's floor — the same tier the other GC
// sweeps use) so it never competes with indexing or user work.
export async function enqueueScopedCssGc({
  priority = systemInitiatedPrerenderHtmlPriority,
  migrateDB,
}: {
  priority?: number;
  migrateDB?: boolean;
} = {}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);

  try {
    let realms = (await dbAdapter.execute(
      `SELECT DISTINCT realm_url FROM scoped_css`,
    )) as { realm_url: string }[];
    for (let { realm_url } of realms) {
      await queue.publish({
        jobType: 'scoped-css-gc',
        concurrencyGroup: indexingConcurrencyGroup(realm_url),
        timeout: SCOPED_CSS_GC_JOB_TIMEOUT_SEC,
        priority,
        args: { realmUrl: realm_url },
      });
    }
    log.info(`enqueued ${realms.length} scoped-css-gc job(s)`);
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue scoped-css-gc jobs', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
