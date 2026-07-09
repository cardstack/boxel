import { CronJob } from 'cron';

// More frequent than the daily crons, but the residue it backstops is rare, so
// it need not be aggressive — hourly by default. Cadence is a tuning knob via
// the env override.
export const PRERENDER_HTML_RECONCILE_CRON_SCHEDULE =
  process.env.PRERENDER_HTML_RECONCILE_CRON_SCHEDULE ?? '0 * * * *';
export const PRERENDER_HTML_RECONCILE_CRON_TZ =
  process.env.PRERENDER_HTML_RECONCILE_CRON_TZ ?? 'America/New_York';

export function createPrerenderHtmlReconcileCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    PRERENDER_HTML_RECONCILE_CRON_SCHEDULE,
    onTick,
    null,
    false,
    PRERENDER_HTML_RECONCILE_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
