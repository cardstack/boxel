import { CronJob } from 'cron';

// Every minute. A render that failed transiently is retried with backoff (5,
// 10, then 20 minutes after each failed attempt), and this tick enqueues a
// retry within a minute of its falling due. It enqueues the prerender-html
// reconcile with `transientOnly`, which reads only the stamped rows, so a tick
// over a healthy system finds nothing. The env override is a tuning knob for
// tests and operators.
export const TRANSIENT_RENDER_RETRY_CRON_SCHEDULE =
  process.env.TRANSIENT_RENDER_RETRY_CRON_SCHEDULE ?? '* * * * *';
export const TRANSIENT_RENDER_RETRY_CRON_TZ =
  process.env.TRANSIENT_RENDER_RETRY_CRON_TZ ?? 'UTC';

export function createTransientRenderRetryCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    TRANSIENT_RENDER_RETRY_CRON_SCHEDULE,
    onTick,
    null,
    false,
    TRANSIENT_RENDER_RETRY_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
