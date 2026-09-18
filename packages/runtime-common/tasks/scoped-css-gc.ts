import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import { jobIdentity } from '../index.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';
import { sweepUnreferencedScopedCSS } from '../scoped-css-gc.ts';

// The cron fan-out enqueues one job per realm holding `scoped_css` rows,
// each in that realm's indexing concurrency group so the sweep serializes
// with the realm's index passes.
export interface ScopedCssGcArgs extends JSONTypes.Object {
  realmUrl: string;
}

export interface ScopedCssGcResult extends JSONTypes.Object {
  rowsSwept: number;
}

function getRealmUrl(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }
  let realmUrl = (args as Record<string, unknown>).realmUrl;
  return typeof realmUrl === 'string' ? realmUrl : undefined;
}

// The concurrency group already serializes execution per realm; this
// additionally collapses a queued tick into any pending or in-flight sweep
// for the same realm so overlapping cron ticks never pile up. The realm is
// the job's whole identity, so a twin fully covers the incoming request —
// garbage the running sweep's scan already missed waits for the next tick.
function chooseScopedCssGcCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates, inFlightCandidates } = context;
  let isTwin = (candidate: { jobType: string; args: unknown }) =>
    candidate.jobType === incoming.jobType &&
    getRealmUrl(candidate.args) === getRealmUrl(incoming.args);
  let twin = candidates.find(isTwin) ?? inFlightCandidates.find(isTwin);
  if (!twin) {
    return { type: 'insert' };
  }
  return { type: 'join', jobId: twin.id };
}

registerQueueJobDefinition({
  jobType: 'scoped-css-gc',
  coalesce: chooseScopedCssGcCoalesceDecision,
});

export { scopedCssGc };

// Reclaims the realm's `scoped_css` rows no live index row references — the
// hashes superseded stylesheet versions left behind, which incremental
// passes produce continually and nothing else deletes. Runs inside the
// realm's indexing concurrency group and behind the grace window
// `sweepUnreferencedScopedCSS` documents, which together make the scan safe
// against in-flight and resumable index passes. A sweep over a fully-live
// table deletes nothing.
const scopedCssGc: Task<ScopedCssGcArgs, ScopedCssGcResult> = ({
  dbAdapter,
  reportStatus,
  log,
}) =>
  async function (args) {
    let { jobInfo, realmUrl } = args;
    reportStatus(jobInfo, 'start');
    let rowsSwept = await sweepUnreferencedScopedCSS(dbAdapter, realmUrl);
    if (rowsSwept > 0) {
      log.info(
        `${jobIdentity(jobInfo)} scoped-css gc: swept ${rowsSwept} unreferenced scoped_css row(s) for ${realmUrl}`,
      );
    } else {
      log.debug(
        `${jobIdentity(jobInfo)} scoped-css gc: nothing to sweep for ${realmUrl}`,
      );
    }
    reportStatus(jobInfo, 'finish');
    return { rowsSwept };
  };
