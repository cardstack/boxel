import type * as JSONTypes from 'json-typescript';
import type { JobInfo } from '../worker.ts';

// The claim-time facts an index or prerender-html job persists about itself, on
// `jobs.result.queueClaim` and on every row it writes, under
// `diagnostics.queueClaim`: how long the job waited between enqueue and claim,
// and the lane and lane family it was claimed in (see
// `QueuePublishRequest.laneFamily`).
//
// A module of its own, importing `worker.ts` for types only, because the task
// modules that write it are imported by `worker.ts`. A value import in that
// direction is a cycle, and a bundle can evaluate it with the tasks still
// undefined when the worker registers them.
export interface QueueClaim extends JSONTypes.Object {
  queueWaitMs: number | null;
  concurrencyGroup: string | null;
  laneFamily: string | null;
}

// The claim a JobInfo describes, or undefined when no queue claim produced it:
// a synthetic JobInfo, or one carrying none of the claim's facts. A real claim
// always measures its wait, so a JobInfo with nothing recorded is not one.
export function queueClaimOf(
  jobInfo: JobInfo | undefined,
): QueueClaim | undefined {
  if (!jobInfo || jobInfo.jobId < 0) {
    return undefined;
  }
  let queueWaitMs = jobInfo.queueWaitMs ?? null;
  let concurrencyGroup = jobInfo.concurrencyGroup ?? null;
  let laneFamily = jobInfo.laneFamily ?? null;
  if (
    queueWaitMs === null &&
    concurrencyGroup === null &&
    laneFamily === null
  ) {
    return undefined;
  }
  return { queueWaitMs, concurrencyGroup, laneFamily };
}

// `IndexingProgressEvent.lane` for a job, spread into the event: the lane it
// was claimed in, so its progress log lines say whose pass it is.
export function progressLaneOf(jobInfo: JobInfo | undefined): {
  lane?: string;
} {
  return jobInfo?.concurrencyGroup ? { lane: jobInfo.concurrencyGroup } : {};
}

// Row diagnostics as they leave the server for a reader of the realm: without
// `queueClaim`. A writer lane's group names the user whose pass wrote the row
// (`indexing:<realm>#user:<matrix id>`), which the `diagnostics` column keeps
// for operators and a reader has no need for. Every path that serves a row's
// diagnostics outside the database goes through here: an error doc's
// `meta.diagnostics`, and `_indexing-errors`.
export function withoutQueueClaim<T extends object>(
  diagnostics: T,
): Omit<T, 'queueClaim'> {
  let { queueClaim: _queueClaim, ...rest } = diagnostics as T & {
    queueClaim?: unknown;
  };
  return rest;
}
