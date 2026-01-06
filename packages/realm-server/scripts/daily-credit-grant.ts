import '../instrument';
import '../setup-logger'; // This should be first
import { logger } from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('daily-credit-grant');
const DAILY_CREDIT_GRANT_JOB_TIMEOUT_SEC = 10 * 60;

export function parseLowCreditThreshold(
  rawThreshold = process.env.LOW_CREDIT_THRESHOLD,
): number {
  if (rawThreshold == null || rawThreshold === '') {
    throw new Error(
      'LOW_CREDIT_THRESHOLD must be set to run daily-credit-grant',
    );
  }
  let lowCreditThreshold = Number(rawThreshold);
  if (!Number.isInteger(lowCreditThreshold) || lowCreditThreshold < 0) {
    throw new Error(
      `LOW_CREDIT_THRESHOLD must be a non-negative integer. Received "${rawThreshold}".`,
    );
  }
  return lowCreditThreshold;
}

export async function enqueueDailyCreditGrant({
  lowCreditThreshold,
  priority = 4,
  migrateDB,
}: {
  lowCreditThreshold: number;
  priority?: number;
  migrateDB?: boolean;
}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);

  try {
    await queue.publish({
      jobType: 'daily-credit-grant',
      concurrencyGroup: 'daily-credit-grant',
      timeout: DAILY_CREDIT_GRANT_JOB_TIMEOUT_SEC,
      priority,
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
