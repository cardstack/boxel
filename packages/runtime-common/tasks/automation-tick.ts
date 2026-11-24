import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import { jobIdentity } from '../index.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';
import { taskAutomationChangeReporter } from '../automation-change-events.ts';
import { taskRunChangeReporter } from '../automation-run-events.ts';
import { tickAutomations } from '../automation-tick.ts';
import { readRunDeclaration } from '../automation-run-limits.ts';
import { startDueAIBatchFollowUps } from '../ai-batch-follow-ups.ts';

// The cron enqueues this job with no arguments; the tick handles whatever is
// due when it runs.
export type AutomationTickArgs = JSONTypes.Object;

export interface AutomationTickResult extends JSONTypes.Object {
  automations: number;
  started: number;
  skipped: number;
  unreadable: number;
  capsRaised: number;
  failed: number;
  // Batches whose deadline passed, by what came of starting their follow-up.
  followUpsStarted: number;
  followUpsFailed: number;
}

export { automationTick };

// Every worker manager fires the cron each minute. A tick that arrives while
// another is still waiting to start joins it, since the waiting one handles
// whatever is due when it runs. A tick that arrives while another is running
// is queued behind it in the concurrency group: the running one read the time
// when it started, so a slot that came due since is the next tick's.
function chooseAutomationTickCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates } = context;
  let twin = candidates.find(
    (candidate) => candidate.jobType === incoming.jobType,
  );
  return twin ? { type: 'join', jobId: twin.id } : { type: 'insert' };
}

registerQueueJobDefinition({
  jobType: 'automation-tick',
  coalesce: chooseAutomationTickCoalesceDecision,
});

const automationTick: Task<AutomationTickArgs, AutomationTickResult> = ({
  dbAdapter,
  queuePublisher,
  definitionLookup,
  virtualNetwork,
  log,
  reportStatus,
  reportRealmEvent,
}) =>
  async function (args) {
    let { jobInfo } = args;
    reportStatus(jobInfo, 'start');
    let reportRunChange = taskRunChangeReporter({
      dbAdapter,
      virtualNetwork,
      reportRealmEvent,
      log,
    });
    try {
      let tag = `${jobIdentity(jobInfo)} automation-tick`;
      let outcomes = await tickAutomations(dbAdapter, {
        queue: queuePublisher,
        virtualNetwork,
        reportAutomationChange: taskAutomationChangeReporter({
          virtualNetwork,
          reportRealmEvent,
          log,
        }),
        reportRunChange,
        readDeclaration: (automationId) =>
          readRunDeclaration({
            dbAdapter,
            definitionLookup,
            virtualNetwork,
            automationId,
          }),
      });
      let result: AutomationTickResult = {
        automations: outcomes.length,
        started: 0,
        skipped: 0,
        unreadable: 0,
        capsRaised: 0,
        failed: 0,
        followUpsStarted: 0,
        followUpsFailed: 0,
      };
      for (let outcome of outcomes) {
        switch (outcome.kind) {
          case 'enqueued':
            for (let trigger of outcome.triggers) {
              if (trigger.kind === 'started') {
                result.started++;
                await reportRunChange?.(trigger.runId);
                log.info(
                  `${tag}: automation ${outcome.automationId} trigger ${trigger.trigger} started run ${trigger.runId} (job ${trigger.jobId}) for ${trigger.slot}`,
                );
              } else {
                result.skipped++;
                log.info(
                  `${tag}: automation ${outcome.automationId} trigger ${trigger.trigger} skipped ${trigger.slot}: it joined pending run ${trigger.joinedRunId}`,
                );
              }
            }
            break;
          case 'not-due':
            log.info(
              `${tag}: automation ${outcome.automationId} had nothing due under its card as indexed; next run ${outcome.nextRun === null ? 'none' : new Date(outcome.nextRun * 1000).toISOString()}`,
            );
            break;
          case 'unreadable':
            result.unreadable++;
            log.warn(
              `${tag}: automation ${outcome.automationId} is due but its card can't be read, so nothing was enqueued${outcome.paused ? ' and it is paused with invalid-declaration' : ''}: ${outcome.message}`,
            );
            break;
          case 'caps-raised':
            result.capsRaised++;
            log.warn(
              `${tag}: automation ${outcome.automationId} is due but its card asks for more than its caps snapshot (${outcome.reason}), so nothing was enqueued`,
            );
            break;
          case 'failed':
            result.failed++;
            log.error(
              `${tag}: automation ${outcome.automationId} failed:`,
              outcome.error,
            );
            break;
        }
      }
      if (outcomes.length > 0) {
        log.info(
          `${tag}: ${result.automations} due, ${result.started} started, ${result.skipped} skipped, ${result.unreadable} unreadable, ${result.capsRaised} caps raised, ${result.failed} failed`,
        );
      }

      // Each batch whose deadline has passed gets its follow-up run, which
      // picks up the batch's results.
      for (let followUp of await startDueAIBatchFollowUps(dbAdapter, {
        queue: queuePublisher,
        virtualNetwork,
      })) {
        switch (followUp.kind) {
          case 'started':
            result.followUpsStarted++;
            await reportRunChange?.(followUp.runId);
            log.info(
              `${tag}: batch ${followUp.batchId} of automation ${followUp.automationId} reached its deadline and started follow-up run ${followUp.runId} (job ${followUp.jobId})`,
            );
            break;
          case 'found':
            log.info(
              `${tag}: batch ${followUp.batchId} of automation ${followUp.automationId} already has follow-up run ${followUp.runId}`,
            );
            break;
          case 'failed':
            result.followUpsFailed++;
            log.error(
              `${tag}: starting the follow-up of batch ${followUp.batchId} of automation ${followUp.automationId} failed:`,
              followUp.error,
            );
            break;
        }
      }
      return result;
    } finally {
      reportStatus(jobInfo, 'finish');
    }
  };
