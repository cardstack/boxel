import { CronJob } from 'cron';

// Daily is plenty: every row the cleanup deletes already reads as missing, so
// it only saves space. Off the top of the hour, and clear of the other
// nightly jobs' slots (2:30, 2:45, 3:00, 4:00). Cadence is a tuning knob via
// the env override.
export const OAUTH_PROVIDER_CLEANUP_CRON_SCHEDULE =
  process.env.OAUTH_PROVIDER_CLEANUP_CRON_SCHEDULE ?? '15 3 * * *';
export const OAUTH_PROVIDER_CLEANUP_CRON_TZ =
  process.env.OAUTH_PROVIDER_CLEANUP_CRON_TZ ?? 'America/New_York';

export function createOAuthProviderCleanupCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    OAUTH_PROVIDER_CLEANUP_CRON_SCHEDULE,
    onTick,
    null,
    false,
    OAUTH_PROVIDER_CLEANUP_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
