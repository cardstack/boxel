import type { QueuePublisher } from '../queue.ts';
import { automationInitiatedPriority } from '../queue.ts';
import type { RunCommandResponse, DBAdapter } from '../index.ts';
import type { RunCommandArgs } from '../tasks/run-command.ts';
import {
  AUTOMATION_COMMAND,
  automationJobTimeoutSec,
  automationRunDedupeKey,
  type AutomationJobInput,
} from '../automation-run-command.ts';

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

// Enqueues one automation run: a `run-command` job naming the automation
// command, for the run row `input.runId` names, which its trigger has already
// created. The job runs in the automation's concurrency group, so an
// automation runs one at a time, at the automation tier, and with a queue
// timeout from the automation's `seconds` cap rather than `run-command`'s
// 60-second default.
export async function enqueueAutomationRunJob(
  queue: QueuePublisher,
  {
    automationId,
    realmURL,
    actsAs,
    trigger,
    slot,
    secondsCap,
    input,
  }: {
    // The automation card's id, as the run row holds it.
    automationId: string;
    realmURL: string;
    // The run's identity, as the run row holds it.
    actsAs: string;
    // The trigger's label (or a click's), and the slot it fired for.
    trigger: string;
    slot: string;
    // The automation's `seconds` cap.
    secondsCap: number;
    input: AutomationJobInput;
  },
) {
  let args: RunCommandArgs = {
    realmURL,
    realmUsername: actsAs,
    runAs: actsAs,
    command: AUTOMATION_COMMAND,
    commandInput: input as unknown as RunCommandArgs['commandInput'],
    dedupeKey: automationRunDedupeKey({ automationId, trigger, slot }),
  };
  return await queue.publish<RunCommandResponse>({
    jobType: 'run-command',
    concurrencyGroup: `automation:${automationId}`,
    timeout: automationJobTimeoutSec(secondsCap),
    priority: automationInitiatedPriority,
    args,
  });
}
