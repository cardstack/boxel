import { CronJob } from 'cron';

// Once a day, just after midnight UTC, when the UTC day the charge is named
// by has ended. The env override is a tuning knob for tests and operators.
export const AUTOMATION_STORAGE_CHARGE_CRON_SCHEDULE =
  process.env.AUTOMATION_STORAGE_CHARGE_CRON_SCHEDULE ?? '15 0 * * *';
export const AUTOMATION_STORAGE_CHARGE_CRON_TZ =
  process.env.AUTOMATION_STORAGE_CHARGE_CRON_TZ ?? 'UTC';

export function createAutomationStorageChargeCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    AUTOMATION_STORAGE_CHARGE_CRON_SCHEDULE,
    onTick,
    null,
    false,
    AUTOMATION_STORAGE_CHARGE_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
