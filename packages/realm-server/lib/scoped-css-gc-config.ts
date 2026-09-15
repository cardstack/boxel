import { CronJob } from 'cron';

// Daily is plenty: superseded stylesheets accumulate at hand-edit pace (one
// content-deduped row of a few KB per distinct edited stylesheet), and the
// sweep's grace window is itself a day, so nothing it reclaims is urgent.
// Off the top of the hour and off the media-cache GC's 2:30 slot. Cadence is
// a tuning knob via the env override.
export const SCOPED_CSS_GC_CRON_SCHEDULE =
  process.env.SCOPED_CSS_GC_CRON_SCHEDULE ?? '45 2 * * *';
export const SCOPED_CSS_GC_CRON_TZ =
  process.env.SCOPED_CSS_GC_CRON_TZ ?? 'America/New_York';

export function createScopedCssGcCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    SCOPED_CSS_GC_CRON_SCHEDULE,
    onTick,
    null,
    false,
    SCOPED_CSS_GC_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
