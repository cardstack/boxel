import type { QueuePublisher } from '../queue';
import type { RunCommandResponse, DBAdapter } from '../index';
import type { RunCommandArgs } from '../tasks/run-command';

export const RUN_COMMAND_JOB_TIMEOUT_SEC = 60;

export async function enqueueRunCommandJob(
  args: RunCommandArgs,
  queue: QueuePublisher,
  _dbAdapter: DBAdapter,
  priority: number,
  opts?: { concurrencyGroup?: string },
) {
  let job = await queue.publish<RunCommandResponse>({
    jobType: 'run-command',
    concurrencyGroup: opts?.concurrencyGroup ?? `command:${args.realmURL}`,
    timeout: RUN_COMMAND_JOB_TIMEOUT_SEC,
    priority,
    args,
  });
  return job;
}
