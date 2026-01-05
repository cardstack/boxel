import './instrument';
import './setup-logger'; // This should be first
import { logger } from '@cardstack/runtime-common';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import yargs from 'yargs';
import * as Sentry from '@sentry/node';

const log = logger('daily-credit-grant');
const DAILY_CREDIT_GRANT_JOB_TIMEOUT_SEC = 10 * 60;

let { priority = 0, migrateDB } = yargs(process.argv.slice(2))
  .usage('Enqueue daily credit grant job')
  .options({
    priority: {
      description: 'The priority of the daily credit grant job (defaults to 0)',
      type: 'number',
    },
    migrateDB: {
      description:
        'When this flag is set the database will automatically migrate before enqueueing',
      type: 'boolean',
    },
  })
  .parseSync();

(async () => {
  let rawThreshold = process.env.LOW_CREDIT_THRESHOLD;
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
    process.exitCode = 1;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
})().catch((error) => {
  Sentry.captureException(error);
  log.error('unexpected error while enqueueing daily-credit-grant job', error);
  process.exit(1);
});
