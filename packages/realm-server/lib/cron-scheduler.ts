import { logger } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import type { CronJob } from 'cron';
import { enqueueDailyCreditGrant } from '../scripts/daily-credit-grant.ts';
import {
  DAILY_CREDIT_GRANT_CRON_TZ,
  createDailyCreditGrantCronJob,
  parseLowCreditThreshold,
} from './daily-credit-grant-config.ts';
import { enqueueSyncOpenRouterModels } from '../scripts/sync-openrouter-models.ts';
import {
  OPENROUTER_SYNC_CRON_TZ,
  createOpenRouterSyncCronJob,
  getOpenRouterRealmURL,
} from './openrouter-sync-config.ts';
import { enqueuePrerenderHtmlReconcile } from '../scripts/prerender-html-reconcile.ts';
import {
  PRERENDER_HTML_RECONCILE_CRON_SCHEDULE,
  PRERENDER_HTML_RECONCILE_CRON_TZ,
  createPrerenderHtmlReconcileCronJob,
} from './prerender-html-reconcile-config.ts';
import { enqueueMediaCacheGc } from '../scripts/media-cache-gc.ts';
import {
  MEDIA_CACHE_GC_CRON_SCHEDULE,
  MEDIA_CACHE_GC_CRON_TZ,
  createMediaCacheGcCronJob,
} from './media-cache-gc-config.ts';
import { enqueueScopedCssGc } from '../scripts/scoped-css-gc.ts';
import { enqueueOAuthProviderCleanup } from '../scripts/oauth-provider-cleanup.ts';
import {
  OAUTH_PROVIDER_CLEANUP_CRON_SCHEDULE,
  OAUTH_PROVIDER_CLEANUP_CRON_TZ,
  createOAuthProviderCleanupCronJob,
} from './oauth-provider-cleanup-config.ts';
import { enqueueAutomationStorageCharge } from '../scripts/automation-storage-charge.ts';
import {
  AUTOMATION_STORAGE_CHARGE_CRON_SCHEDULE,
  AUTOMATION_STORAGE_CHARGE_CRON_TZ,
  createAutomationStorageChargeCronJob,
} from './automation-storage-charge-config.ts';
import { enqueueAutomationTick } from '../scripts/automation-tick.ts';
import {
  AUTOMATION_TICK_CRON_SCHEDULE,
  AUTOMATION_TICK_CRON_TZ,
  createAutomationTickCronJob,
} from './automation-tick-config.ts';
import { enqueueAutomationReconcile } from '../scripts/automation-reconcile.ts';
import { enqueueAIBatchSettle } from '../scripts/ai-batch-settle.ts';
import {
  AI_BATCH_SETTLE_CRON_SCHEDULE,
  AI_BATCH_SETTLE_CRON_TZ,
  createAIBatchSettleCronJob,
} from './ai-batch-settle-config.ts';
import {
  AUTOMATION_RECONCILE_CRON_SCHEDULE,
  AUTOMATION_RECONCILE_CRON_TZ,
  createAutomationReconcileCronJob,
} from './automation-reconcile-config.ts';
import {
  SCOPED_CSS_GC_CRON_SCHEDULE,
  SCOPED_CSS_GC_CRON_TZ,
  createScopedCssGcCronJob,
} from './scoped-css-gc-config.ts';

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

  let prerenderHtmlReconcileJob = startPrerenderHtmlReconcileCron();
  if (prerenderHtmlReconcileJob) {
    jobs.push(prerenderHtmlReconcileJob);
  }

  let mediaCacheGcJob = startMediaCacheGcCron();
  if (mediaCacheGcJob) {
    jobs.push(mediaCacheGcJob);
  }

  let scopedCssGcJob = startScopedCssGcCron();
  if (scopedCssGcJob) {
    jobs.push(scopedCssGcJob);
  }

  jobs.push(startOAuthProviderCleanupCron());

  jobs.push(startAutomationStorageChargeCron());

  jobs.push(startAutomationTickCron());

  jobs.push(startAutomationReconcileCron());

  jobs.push(startAIBatchSettleCron());
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
        await enqueueDailyCreditGrant({ lowCreditThreshold });
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

function startPrerenderHtmlReconcileCron(): CronJob | undefined {
  let job = createPrerenderHtmlReconcileCronJob(
    async () => {
      try {
        await enqueuePrerenderHtmlReconcile();
      } catch (error) {
        Sentry.captureException(error);
        log.error('prerender-html-reconcile cron failed to enqueue job', error);
      }
    },
    { runOnInit: false },
  );

  job.start();
  log.info(
    `prerender-html-reconcile cron scheduled for ${PRERENDER_HTML_RECONCILE_CRON_SCHEDULE} ${PRERENDER_HTML_RECONCILE_CRON_TZ}`,
  );
  return job;
}

function startMediaCacheGcCron(): CronJob | undefined {
  let job = createMediaCacheGcCronJob(
    async () => {
      try {
        await enqueueMediaCacheGc();
      } catch (error) {
        Sentry.captureException(error);
        log.error('media-cache-gc cron failed to enqueue job', error);
      }
    },
    { runOnInit: false },
  );

  job.start();
  log.info(
    `media-cache-gc cron scheduled for ${MEDIA_CACHE_GC_CRON_SCHEDULE} ${MEDIA_CACHE_GC_CRON_TZ}`,
  );
  return job;
}

function startOAuthProviderCleanupCron(): CronJob {
  let job = createOAuthProviderCleanupCronJob(
    async () => {
      try {
        await enqueueOAuthProviderCleanup();
      } catch (error) {
        Sentry.captureException(error);
        log.error('oauth-provider-cleanup cron failed to enqueue job', error);
      }
    },
    { runOnInit: false },
  );

  job.start();
  log.info(
    `oauth-provider-cleanup cron scheduled for ${OAUTH_PROVIDER_CLEANUP_CRON_SCHEDULE} ${OAUTH_PROVIDER_CLEANUP_CRON_TZ}`,
  );
  return job;
}

function startScopedCssGcCron(): CronJob | undefined {
  let job = createScopedCssGcCronJob(
    async () => {
      try {
        await enqueueScopedCssGc();
      } catch (error) {
        Sentry.captureException(error);
        log.error('scoped-css-gc cron failed to enqueue jobs', error);
      }
    },
    { runOnInit: false },
  );

  job.start();
  log.info(
    `scoped-css-gc cron scheduled for ${SCOPED_CSS_GC_CRON_SCHEDULE} ${SCOPED_CSS_GC_CRON_TZ}`,
  );
  return job;
}

function startAutomationStorageChargeCron(): CronJob {
  let job = createAutomationStorageChargeCronJob(
    async () => {
      try {
        await enqueueAutomationStorageCharge();
      } catch (error) {
        Sentry.captureException(error);
        log.error(
          'automation-storage-charge cron failed to enqueue job',
          error,
        );
      }
    },
    { runOnInit: false },
  );

  job.start();
  log.info(
    `automation-storage-charge cron scheduled for ${AUTOMATION_STORAGE_CHARGE_CRON_SCHEDULE} ${AUTOMATION_STORAGE_CHARGE_CRON_TZ}`,
  );
  return job;
}

function startAIBatchSettleCron(): CronJob {
  let job = createAIBatchSettleCronJob(
    async () => {
      try {
        await enqueueAIBatchSettle();
      } catch (error) {
        Sentry.captureException(error);
        log.error('ai-batch-settle cron failed to enqueue job', error);
      }
    },
    { runOnInit: false },
  );

  job.start();
  log.info(
    `ai-batch-settle cron scheduled for ${AI_BATCH_SETTLE_CRON_SCHEDULE} ${AI_BATCH_SETTLE_CRON_TZ}`,
  );
  return job;
}

function startAutomationTickCron(): CronJob {
  let job = createAutomationTickCronJob(
    async () => {
      try {
        await enqueueAutomationTick();
      } catch (error) {
        Sentry.captureException(error);
        log.error('automation-tick cron failed to enqueue job', error);
      }
    },
    { runOnInit: false },
  );

  job.start();
  log.info(
    `automation-tick cron scheduled for ${AUTOMATION_TICK_CRON_SCHEDULE} ${AUTOMATION_TICK_CRON_TZ}`,
  );
  return job;
}

// Runs on init too: reconcile at startup is what makes up a run an outage
// cost without waiting for the first scheduled pass.
function startAutomationReconcileCron(): CronJob {
  let job = createAutomationReconcileCronJob(
    async () => {
      try {
        await enqueueAutomationReconcile();
      } catch (error) {
        Sentry.captureException(error);
        log.error('automation-reconcile cron failed to enqueue job', error);
      }
    },
    { runOnInit: true },
  );

  job.start();
  log.info(
    `automation-reconcile cron scheduled for ${AUTOMATION_RECONCILE_CRON_SCHEDULE} ${AUTOMATION_RECONCILE_CRON_TZ}, and once at startup`,
  );
  return job;
}
