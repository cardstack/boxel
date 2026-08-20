import { CronJob } from 'cron';

// Daily is plenty: the sweep's min-age delay is measured in hours and the
// on-demand TTL in days, so nothing it reclaims is urgent. Off the top of
// the hour to stay clear of the hourly prerender-html reconcile. Cadence is
// a tuning knob via the env override.
export const MEDIA_CACHE_GC_CRON_SCHEDULE =
  process.env.MEDIA_CACHE_GC_CRON_SCHEDULE ?? '30 2 * * *';
export const MEDIA_CACHE_GC_CRON_TZ =
  process.env.MEDIA_CACHE_GC_CRON_TZ ?? 'America/New_York';

export function createMediaCacheGcCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    MEDIA_CACHE_GC_CRON_SCHEDULE,
    onTick,
    null,
    false,
    MEDIA_CACHE_GC_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
