import { CronJob } from 'cron';

export const OPENROUTER_SYNC_CRON_SCHEDULE =
  process.env.OPENROUTER_SYNC_CRON_SCHEDULE ?? '0 4 * * *';
export const OPENROUTER_SYNC_CRON_TZ =
  process.env.OPENROUTER_SYNC_CRON_TZ ?? 'America/New_York';

export function getOpenRouterRealmURL(): string | undefined {
  return process.env.OPENROUTER_REALM_URL || undefined;
}

export function createOpenRouterSyncCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    OPENROUTER_SYNC_CRON_SCHEDULE,
    onTick,
    null,
    false,
    OPENROUTER_SYNC_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
