import { logger } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import type { CronJob } from 'cron';
import { enqueueDailyCreditGrant } from '../scripts/daily-credit-grant';
import {
  DAILY_CREDIT_GRANT_CRON_TZ,
  createDailyCreditGrantCronJob,
  parseLowCreditThreshold,
} from './daily-credit-grant-config';
import { enqueueSyncOpenRouterModels } from '../scripts/sync-openrouter-models';
import {
  OPENROUTER_SYNC_CRON_TZ,
  createOpenRouterSyncCronJob,
  getOpenRouterRealmURL,
} from './openrouter-sync-config';

let log = logger('cron-scheduler');

let jobs: CronJob[] = [];

export function startCronJobs(): void {
  let dailyCreditJob = startDailyCreditGrantCron();
  if (dailyCreditJob) {
    jobs.push(dailyCreditJob);
  }

  let openRouterJob = startOpenRouterSyncCron();
  if (openRouterJob) {
    jobs.push(openRouterJob);
  }
}

export function stopCronJobs(): void {
  for (let job of jobs) {
    job.stop();
  }
  if (jobs.length > 0) {
    log.info(`Stopped ${jobs.length} cron job(s)`);
  }
  jobs = [];
}

function startDailyCreditGrantCron(): CronJob | undefined {
  let lowCreditThreshold = parseLowCreditThreshold();
  let job = createDailyCreditGrantCronJob(
    async () => {
      try {
        await enqueueDailyCreditGrant({
          lowCreditThreshold,
          priority: 4,
        });
      } catch (error) {
        Sentry.captureException(error);
        log.error('daily-credit-grant cron failed to enqueue job', error);
      }
    },
    { runOnInit: true },
  );

  job.start();
  log.info(
    `daily-credit-grant cron scheduled for 3:00am ${DAILY_CREDIT_GRANT_CRON_TZ}`,
  );
  return job;
}

function startOpenRouterSyncCron(): CronJob | undefined {
  let realmURL = getOpenRouterRealmURL();
  if (!realmURL) {
    log.info(
      'OPENROUTER_REALM_URL not set, skipping openrouter-sync cron setup',
    );
    return undefined;
  }
  let job = createOpenRouterSyncCronJob(
    async () => {
      try {
        await enqueueSyncOpenRouterModels({ realmURL: realmURL! });
      } catch (error) {
        Sentry.captureException(error);
        log.error('openrouter-sync cron failed to enqueue job', error);
      }
    },
    { runOnInit: false },
  );

  job.start();
  log.info(
    `openrouter-sync cron scheduled for 4:00am ${OPENROUTER_SYNC_CRON_TZ}`,
  );
  return job;
}
