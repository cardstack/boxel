import { CronJob } from 'cron';

// Every five minutes. A batch's cost reads as pending until a pass bills it,
// and most batches end within minutes of being submitted. The env override is
// a tuning knob for tests and operators.
export const AI_BATCH_SETTLE_CRON_SCHEDULE =
  process.env.AI_BATCH_SETTLE_CRON_SCHEDULE ?? '*/5 * * * *';
export const AI_BATCH_SETTLE_CRON_TZ =
  process.env.AI_BATCH_SETTLE_CRON_TZ ?? 'UTC';

export function createAIBatchSettleCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    AI_BATCH_SETTLE_CRON_SCHEDULE,
    onTick,
    null,
    false,
    AI_BATCH_SETTLE_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
