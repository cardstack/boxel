import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import { jobIdentity } from '../index.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';
import {
  deleteMediaCacheRows,
  findMediaCacheGcCandidates,
  findMediaCacheKeyReferenceCounts,
  planMediaCacheGcDeletions,
  type MediaCacheGcReason,
} from '../media-cache.ts';

// The cron enqueues this job with no arguments; it sweeps the whole ledger.
type MediaCacheGcArgs = JSONTypes.Object;

export interface MediaCacheGcResult extends JSONTypes.Object {
  rowsDeleted: number;
  objectsDeleted: number;
  // Objects whose adapter delete failed this sweep. Their ledger rows are
  // kept so the next sweep re-finds and retries them.
  objectDeleteFailures: number;
}

export { mediaCacheGc };

// The fixed concurrency group already serializes execution to one sweep at a
// time; this additionally collapses a queued tick into any pending or
// in-flight sweep so overlapping cron ticks never pile up. The sweep carries
// no args, so there is nothing to merge — a twin simply wins.
function chooseMediaCacheGcCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates, inFlightCandidates } = context;
  let twin =
    candidates.find((candidate) => candidate.jobType === incoming.jobType) ??
    inFlightCandidates.find(
      (candidate) => candidate.jobType === incoming.jobType,
    );
  if (!twin) {
    return { type: 'insert' };
  }
  return { type: 'join', jobId: twin.id };
}

registerQueueJobDefinition({
  jobType: 'media-cache-gc',
  coalesce: chooseMediaCacheGcCoalesceDecision,
});

// Reconcile-style GC for the MediaCache: reclaims ledger rows whose capture
// is superseded by a newer generation, whose source instance is tombstoned,
// or (on-demand lane) idle past the TTL — then deletes each object whose
// last ledger reference those rows held. Objects are deleted before their
// rows so a sweep that dies mid-way leaves rows behind for the next sweep to
// re-find, never bytes the ledger no longer knows about (the ledger is the
// only catalog — an object with no row is unreachable to GC forever).
// Adapter deletes are idempotent, so the re-found rows re-delete harmlessly.
// A sweep over a healthy, fully-live ledger deletes nothing.
const mediaCacheGc: Task<MediaCacheGcArgs, MediaCacheGcResult> = ({
  dbAdapter,
  mediaCacheAdapter,
  reportStatus,
  log,
}) =>
  async function (args) {
    let { jobInfo } = args;
    reportStatus(jobInfo, 'start');

    if (!mediaCacheAdapter) {
      log.info(
        `${jobIdentity(jobInfo)} media-cache gc: no media cache adapter configured; nothing to sweep`,
      );
      reportStatus(jobInfo, 'finish');
      return { rowsDeleted: 0, objectsDeleted: 0, objectDeleteFailures: 0 };
    }

    let candidates = await findMediaCacheGcCandidates(dbAdapter);
    if (candidates.length === 0) {
      log.debug(`${jobIdentity(jobInfo)} media-cache gc: no candidates`);
      reportStatus(jobInfo, 'finish');
      return { rowsDeleted: 0, objectsDeleted: 0, objectDeleteFailures: 0 };
    }

    let referenceCounts = await findMediaCacheKeyReferenceCounts(
      dbAdapter,
      candidates.map((candidate) => candidate.objectKey),
    );
    let plan = planMediaCacheGcDeletions(candidates, referenceCounts);

    let objectsDeleted = 0;
    let failedKeys = new Set<string>();
    for (let objectKey of plan.objectKeys) {
      try {
        await mediaCacheAdapter.delete(objectKey);
        objectsDeleted++;
      } catch (error: any) {
        failedKeys.add(objectKey);
        log.error(
          `${jobIdentity(jobInfo)} media-cache gc: failed to delete object ${objectKey}`,
          error,
        );
      }
    }

    // A row whose object delete failed must survive: it is the ledger's only
    // record that the object exists, and the next sweep's retry path.
    let rowsToDelete = plan.rows.filter(
      (row) => !failedKeys.has(row.objectKey),
    );
    await deleteMediaCacheRows(dbAdapter, rowsToDelete);

    let byReason = new Map<MediaCacheGcReason, number>();
    for (let row of rowsToDelete) {
      byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
    }
    log.info(
      `${jobIdentity(jobInfo)} media-cache gc: deleted ${rowsToDelete.length} ledger row(s) ` +
        `(${[...byReason].map(([reason, count]) => `${count} ${reason}`).join(', ') || 'none'}) ` +
        `and ${objectsDeleted} object(s)` +
        (failedKeys.size > 0
          ? `; ${failedKeys.size} object delete(s) failed and were kept for the next sweep`
          : ''),
    );
    reportStatus(jobInfo, 'finish');
    return {
      rowsDeleted: rowsToDelete.length,
      objectsDeleted,
      objectDeleteFailures: failedKeys.size,
    };
  };
