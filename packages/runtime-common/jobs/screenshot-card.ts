import type { QueuePublisher } from '../queue.ts';
import type { ScreenshotPrerenderResponse, DBAdapter } from '../index.ts';
import type { ScreenshotCardArgs } from '../tasks/screenshot-card.ts';

export const SCREENSHOT_CARD_JOB_TIMEOUT_SEC = 60;

export async function enqueueScreenshotCardJob(
  args: ScreenshotCardArgs,
  queue: QueuePublisher,
  _dbAdapter: DBAdapter,
  priority: number,
  opts?: { concurrencyGroup?: string },
) {
  let job = await queue.publish<ScreenshotPrerenderResponse>({
    jobType: 'screenshot-card',
    concurrencyGroup: opts?.concurrencyGroup ?? `screenshot:${args.realmURL}`,
    timeout: SCREENSHOT_CARD_JOB_TIMEOUT_SEC,
    priority,
    args,
  });
  return job;
}
