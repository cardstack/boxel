import { CronJob } from 'cron';

// Hourly by default. Recovery also runs whenever a realm is mounted and
// whenever a write finds disk behind HEAD, so the schedule is the backstop
// for what those miss: an edit made to disk directly while the realm was up,
// and a write whose answer was lost and never retried. Each run scans every
// file of every realm that records, so the cadence is a tuning knob via the
// env override. Off the top of the hour to stay clear of the hourly
// prerender-html reconcile.
export const REALM_HISTORY_RECOVERY_CRON_SCHEDULE =
  process.env.REALM_HISTORY_RECOVERY_CRON_SCHEDULE ?? '20 * * * *';
export const REALM_HISTORY_RECOVERY_CRON_TZ =
  process.env.REALM_HISTORY_RECOVERY_CRON_TZ ?? 'America/New_York';

export function createRealmHistoryRecoveryCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    REALM_HISTORY_RECOVERY_CRON_SCHEDULE,
    onTick,
    null,
    false,
    REALM_HISTORY_RECOVERY_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
