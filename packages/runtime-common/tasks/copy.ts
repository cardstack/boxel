import type { Task, WorkerArgs } from './index';

import { jobIdentity } from '../index';
import {
  type QueueCoalesceCandidate,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
  registerQueueJobDefinition,
} from '../queue';

export { copy };

export interface CopyArgs extends WorkerArgs {
  sourceRealmURL: string;
}

export interface CopyResult {
  totalNonErrorIndexEntries: number;
  invalidations: string[];
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function copySourceMatches(
  candidate: QueueCoalesceCandidate,
  incoming: { args: unknown },
): boolean {
  if (!isObjectLike(candidate.args) || !isObjectLike(incoming.args)) {
    return false;
  }
  return (
    candidate.args.realmURL === incoming.args.realmURL &&
    candidate.args.sourceRealmURL === incoming.args.sourceRealmURL
  );
}

function chooseCopyCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates } = context;
  // Only join when the destination realm AND source realm both match the
  // incoming spec. Different (destination, source) tuples represent distinct
  // work even though they share the indexing concurrency group.
  let twin = candidates.find(
    (candidate) =>
      candidate.jobType === incoming.jobType &&
      copySourceMatches(candidate, incoming),
  );
  if (!twin) {
    return { type: 'insert' };
  }
  return {
    type: 'join',
    jobId: twin.id,
    update: {
      priority: Math.max(twin.priority, incoming.priority),
      timeout: Math.max(twin.timeout, incoming.timeout),
    },
  };
}

registerQueueJobDefinition({
  jobType: 'copy-index',
  coalesce: chooseCopyCoalesceDecision,
});

const copy: Task<CopyArgs, CopyResult> = ({
  reportStatus,
  log,
  indexWriter,
  virtualNetwork,
}) =>
  async function (args) {
    let { jobInfo, realmURL, sourceRealmURL } = args;
    log.debug(
      `${jobIdentity(jobInfo)} starting copy indexing for job: ${JSON.stringify(args)}`,
    );
    reportStatus(jobInfo, 'start');
    let batch = await indexWriter.createBatch(
      new URL(realmURL),
      virtualNetwork,
    );
    await batch.copyFrom(new URL(sourceRealmURL));
    let result = await batch.done();
    let invalidations = batch.invalidations;
    log.debug(
      `${jobIdentity(jobInfo)} completed copy indexing for realm ${realmURL}:\n${JSON.stringify(
        result,
        null,
        2,
      )}`,
    );
    let { totalIndexEntries: totalNonErrorIndexEntries } = result;
    reportStatus(jobInfo, 'finish');
    return {
      invalidations,
      totalNonErrorIndexEntries,
    };
  };
