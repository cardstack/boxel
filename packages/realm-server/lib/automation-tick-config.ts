import { CronJob } from 'cron';

// Every minute. Cron and one-time triggers are scheduled to the minute, so a
// due run starts within a minute of its time. The env override is a tuning
// knob for tests and operators.
export const AUTOMATION_TICK_CRON_SCHEDULE =
  process.env.AUTOMATION_TICK_CRON_SCHEDULE ?? '* * * * *';
export const AUTOMATION_TICK_CRON_TZ =
  process.env.AUTOMATION_TICK_CRON_TZ ?? 'UTC';

export function createAutomationTickCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    AUTOMATION_TICK_CRON_SCHEDULE,
    onTick,
    null,
    false,
    AUTOMATION_TICK_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
