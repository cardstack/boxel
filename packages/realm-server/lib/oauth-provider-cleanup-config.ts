import { CronJob } from 'cron';

// Daily is plenty: every row the cleanup deletes already reads as missing, and
// it keeps clients that never connected far below the cap at which
// registration is refused (`oauth-provider/unconnected-client-cap.ts`, which
// warns at boot when this schedule leaves too long a gap). Off the top of the
// hour, and clear of the other nightly jobs' slots (2:30, 2:45, 3:00, 4:00).
// Cadence is a tuning knob via the env override.
export const OAUTH_PROVIDER_CLEANUP_CRON_SCHEDULE =
  process.env.OAUTH_PROVIDER_CLEANUP_CRON_SCHEDULE ?? '15 3 * * *';
export const OAUTH_PROVIDER_CLEANUP_CRON_TZ =
  process.env.OAUTH_PROVIDER_CLEANUP_CRON_TZ ?? 'America/New_York';

// The longest gap between two cleanups over the next week of the schedule, in
// seconds.
export function longestOAuthProviderCleanupGapSeconds(): number {
  let job = createOAuthProviderCleanupCronJob(() => {});
  let runs = job.nextDates(8).map((date) => date.toMillis());
  let longest = 0;
  for (let i = 1; i < runs.length; i++) {
    longest = Math.max(longest, runs[i] - runs[i - 1]);
  }
  return longest / 1000;
}

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
