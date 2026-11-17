import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import { jobIdentity } from '../index.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';

// The cron enqueues this job with no arguments; a pass settles whatever has
// ended when it runs.
export type AIBatchSettleArgs = JSONTypes.Object;

export interface AIBatchSettleResult extends JSONTypes.Object {
  settled: number;
  open: number;
  failed: number;
  unrecorded: number;
}

export { aiBatchSettle };

// Every worker manager fires the cron. A pass that arrives while another is
// still waiting to start joins it, since the waiting one settles whatever has
// ended when it runs. Every step of a settlement is safe to repeat, so a pass
// queued behind a running one only finds less to do.
function chooseAIBatchSettleCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates } = context;
  let twin = candidates.find(
    (candidate) => candidate.jobType === incoming.jobType,
  );
  return twin ? { type: 'join', jobId: twin.id } : { type: 'insert' };
}

registerQueueJobDefinition({
  jobType: 'ai-batch-settle',
  coalesce: chooseAIBatchSettleCoalesceDecision,
});

// Bills each batch of AI requests that has ended (ADR 030 §1.4), through the
// realm server's `AIBatchSettlement`.
const aiBatchSettle: Task<AIBatchSettleArgs, AIBatchSettleResult> = ({
  aiBatchSettlement,
  log,
  reportStatus,
}) =>
  async function (args) {
    let { jobInfo } = args;
    reportStatus(jobInfo, 'start');
    try {
      let tag = `${jobIdentity(jobInfo)} ai-batch-settle`;
      if (!aiBatchSettlement) {
        log.error(
          `${tag}: this worker can't settle batches, so none is billed`,
        );
        return { settled: 0, open: 0, failed: 0, unrecorded: 0 };
      }
      let result = await aiBatchSettlement.settle();
      let { settled, open, failed, unrecorded } = result;
      if (settled + failed + unrecorded > 0) {
        log.info(
          `${tag}: ${settled} settled, ${open} still open, ${failed} not read or billed, ${unrecorded} unrecorded found`,
        );
      } else {
        log.debug(`${tag}: ${open} still open`);
      }
      return { ...result };
    } finally {
      reportStatus(jobInfo, 'finish');
    }
  };
