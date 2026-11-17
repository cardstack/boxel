import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import { jobIdentity } from '../index.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';
import { reconcileAutomations } from '../automation-reconcile.ts';
import { readRunDeclaration } from '../automation-run-limits.ts';

// The cron enqueues this job with no arguments; each pass reconciles
// whatever it finds missed when it runs.
export type AutomationReconcileArgs = JSONTypes.Object;

export interface AutomationReconcileResult extends JSONTypes.Object {
  // Runs whose job was gone, by what reconcile did with each.
  requeued: number;
  ended: number;
  left: number;
  failed: number;
  // Automations whose next run the tick had missed, and the runs the tick's
  // procedure started and skipped for them.
  overdue: number;
  madeUp: number;
  skipped: number;
}

export { automationReconcile };

// Every worker manager enqueues a pass when it starts and on the cron. A pass
// that arrives while another is still waiting joins it, since the waiting one
// reconciles whatever it finds when it runs. One that arrives while another
// runs queues behind it in the concurrency group.
function chooseAutomationReconcileCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates } = context;
  let twin = candidates.find(
    (candidate) => candidate.jobType === incoming.jobType,
  );
  return twin ? { type: 'join', jobId: twin.id } : { type: 'insert' };
}

registerQueueJobDefinition({
  jobType: 'automation-reconcile',
  coalesce: chooseAutomationReconcileCoalesceDecision,
});

const automationReconcile: Task<
  AutomationReconcileArgs,
  AutomationReconcileResult
> = ({
  dbAdapter,
  queuePublisher,
  definitionLookup,
  virtualNetwork,
  meteredCharges,
  log,
  reportStatus,
}) =>
  async function (args) {
    let { jobInfo } = args;
    reportStatus(jobInfo, 'start');
    try {
      let tag = `${jobIdentity(jobInfo)} automation-reconcile`;
      let reconciled = await reconcileAutomations(dbAdapter, {
        queue: queuePublisher,
        virtualNetwork,
        meteredCharges,
        log,
        readDeclaration: (automationId) =>
          readRunDeclaration({
            dbAdapter,
            definitionLookup,
            virtualNetwork,
            automationId,
          }),
      });
      let result: AutomationReconcileResult = {
        requeued: 0,
        ended: 0,
        left: 0,
        failed: 0,
        overdue: 0,
        madeUp: 0,
        skipped: 0,
      };
      for (let outcome of reconciled.lostRuns) {
        switch (outcome.kind) {
          case 'requeued':
            result.requeued++;
            log.warn(
              `${tag}: run ${outcome.runId} of automation ${outcome.automationId} (trigger ${outcome.trigger}, slot ${outcome.slot}) had no live job; enqueued it again as job ${outcome.jobId}`,
            );
            break;
          case 'ended':
            result.ended++;
            log.warn(
              `${tag}: run ${outcome.run.id} of automation ${outcome.run.automationId} (trigger ${outcome.run.trigger}, slot ${outcome.run.slot}) had no live job and ended ${outcome.run.state}: ${outcome.why}`,
            );
            break;
          case 'left':
            result.left++;
            log.warn(
              `${tag}: run ${outcome.runId} of automation ${outcome.automationId} has no live job, left for a later pass: ${outcome.why}`,
            );
            break;
          case 'failed':
            result.failed++;
            log.error(
              `${tag}: run ${outcome.runId} of automation ${outcome.automationId} failed:`,
              outcome.error,
            );
            break;
        }
      }
      for (let outcome of reconciled.overdue) {
        result.overdue++;
        switch (outcome.kind) {
          case 'enqueued':
            for (let trigger of outcome.triggers) {
              if (trigger.kind === 'started') {
                result.madeUp++;
                log.warn(
                  `${tag}: automation ${outcome.automationId} trigger ${trigger.trigger} was overdue; made up run ${trigger.runId} (job ${trigger.jobId}) for ${trigger.slot}`,
                );
              } else {
                result.skipped++;
                log.info(
                  `${tag}: automation ${outcome.automationId} trigger ${trigger.trigger} was overdue; ${trigger.slot} joined pending run ${trigger.joinedRunId}`,
                );
              }
            }
            break;
          case 'not-due':
            log.info(
              `${tag}: automation ${outcome.automationId} was overdue but had nothing due under its card as indexed`,
            );
            break;
          case 'unreadable':
            log.warn(
              `${tag}: automation ${outcome.automationId} is overdue but its card can't be read: ${outcome.message}`,
            );
            break;
          case 'caps-raised':
            log.warn(
              `${tag}: automation ${outcome.automationId} is overdue but its card asks for more than its caps snapshot (${outcome.reason})`,
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
      for (let [name, count] of Object.entries(reconciled.steps)) {
        if (count > 0) {
          result.madeUp += count;
          log.warn(`${tag}: ${name} made up ${count} run(s)`);
        }
      }
      if (
        reconciled.lostRuns.length > 0 ||
        reconciled.overdue.length > 0 ||
        Object.values(reconciled.steps).some((count) => count > 0)
      ) {
        log.info(
          `${tag}: ${result.requeued} requeued, ${result.ended} ended, ${result.left} left, ${result.overdue} overdue, ${result.madeUp} made up, ${result.skipped} skipped, ${result.failed} failed`,
        );
      }
      return result;
    } finally {
      reportStatus(jobInfo, 'finish');
    }
  };
