import { CronJob } from 'cron';

// Every five minutes, and once when the worker manager starts. A run lost to
// an outage is made up within a few minutes of the worker coming back; the
// minute tick handles everything on time. The env override is a tuning knob
// for tests and operators.
export const AUTOMATION_RECONCILE_CRON_SCHEDULE =
  process.env.AUTOMATION_RECONCILE_CRON_SCHEDULE ?? '*/5 * * * *';
export const AUTOMATION_RECONCILE_CRON_TZ =
  process.env.AUTOMATION_RECONCILE_CRON_TZ ?? 'UTC';

export function createAutomationReconcileCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    AUTOMATION_RECONCILE_CRON_SCHEDULE,
    onTick,
    null,
    false,
    AUTOMATION_RECONCILE_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
