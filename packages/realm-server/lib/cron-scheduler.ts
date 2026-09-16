import { logger, systemInitiatedPriority } from '@cardstack/runtime-common';
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
import { enqueueLatticeClockSweep } from '../scripts/lattice-clock-sweep.ts';
import {
  LATTICE_CLOCK_SWEEP_CRON_SCHEDULE,
  LATTICE_CLOCK_SWEEP_CRON_TZ,
  createLatticeClockSweepCronJob,
} from './lattice-clock-sweep-config.ts';
import {
  MEDIA_CACHE_GC_CRON_SCHEDULE,
  MEDIA_CACHE_GC_CRON_TZ,
  createMediaCacheGcCronJob,
} from './media-cache-gc-config.ts';
import { enqueueScopedCssGc } from '../scripts/scoped-css-gc.ts';
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

  let clockSweepJob = startLatticeClockSweepCron();
  if (clockSweepJob) {
    jobs.push(clockSweepJob);
  }
  let scopedCssGcJob = startScopedCssGcCron();
  if (scopedCssGcJob) {
    jobs.push(scopedCssGcJob);
  }
}

// Lattice time grain: re-index rows whose valid_until has passed. Only
// realms with grained computeds ever have such rows; the job is a no-op
// otherwise.
function startLatticeClockSweepCron(): CronJob | undefined {
  if (process.env.LATTICE_CLOCK_SWEEP_DISABLED === 'true') {
    return undefined;
  }
  let job = createLatticeClockSweepCronJob(async () => {
    try {
      await enqueueLatticeClockSweep({ priority: systemInitiatedPriority });
    } catch (error) {
      Sentry.captureException(error);
      log.error('lattice-clock-sweep cron failed to enqueue job', error);
    }
  });
  job.start();
  log.info(
    `lattice-clock-sweep cron scheduled (${LATTICE_CLOCK_SWEEP_CRON_SCHEDULE} ${LATTICE_CLOCK_SWEEP_CRON_TZ})`,
  );
  return job;
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
          priority: systemInitiatedPriority,
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
