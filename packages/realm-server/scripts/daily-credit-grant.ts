import '../instrument.ts';
import '../setup-logger.ts'; // This should be first
import { logger, userInitiatedPriority } from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';
export { parseLowCreditThreshold } from '../lib/daily-credit-grant-config.ts';

const log = logger('daily-credit-grant');
const DAILY_CREDIT_GRANT_JOB_TIMEOUT_SEC = 10 * 60;

// The grant is queued at the user-initiated tier although the cron initiates
// it. A system-tier job can only be claimed by the all-priority pool, which a
// full reindex keeps busy for hours, and every user low on credits waits on
// this one job until it runs. At this tier the high-priority pool claims it
// as well. The job finishes in well under a second, so it holds a
// high-priority worker only briefly.
export async function enqueueDailyCreditGrant({
  lowCreditThreshold,
  migrateDB,
}: {
  lowCreditThreshold: number;
  migrateDB?: boolean;
}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);

  try {
    await queue.publish({
      jobType: 'daily-credit-grant',
      concurrencyGroup: 'daily-credit-grant',
      timeout: DAILY_CREDIT_GRANT_JOB_TIMEOUT_SEC,
      priority: userInitiatedPriority,
      args: { lowCreditThreshold },
    });
    log.info('enqueued daily-credit-grant job');
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue daily-credit-grant job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
