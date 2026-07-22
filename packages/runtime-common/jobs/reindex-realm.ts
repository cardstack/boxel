import type { DBAdapter, QueuePublisher } from '..//index.ts';
import { param, query } from '..//index.ts';
import {
  FROM_SCRATCH_JOB_TIMEOUT_SEC,
  type FromScratchResult,
} from '../tasks/indexer.ts';

interface EnqueueReindexRealmJobOptions {
  clearLastModified?: boolean;
  // Set only by the publish flow. A publish blocks on the published realm's
  // HTML before reporting it ready, so the prerender-html job this index pass
  // spawns must run co-equal with indexing rather than one tier below it (see
  // prerenderHtmlPriority). Surfaced in the from-scratch args, and carried
  // only when true so ordinary index args keep their existing shape.
  awaitedByPublish?: boolean;
}

export async function enqueueReindexRealmJob(
  realmUrl: string,
  realmUsername: string,
  queue: QueuePublisher,
  dbAdapter: DBAdapter,
  priority: number,
  opts?: EnqueueReindexRealmJobOptions,
) {
  // Flagging the args so the from-scratch coalesce can refuse to attach
  // a forced-refresh publish to an already-running same-realm
  // from-scratch whose mtimes snapshot pre-dates the clear below.
  let clearLastModified = opts?.clearLastModified === true;
  let args = {
    realmURL: realmUrl,
    realmUsername,
    clearLastModified,
    ...(opts?.awaitedByPublish ? { awaitedByPublish: true } : {}),
  };
  if (clearLastModified) {
    await query(dbAdapter, [
      `UPDATE boxel_index SET last_modified = NULL WHERE realm_url =`,
      param(realmUrl),
    ]);
  }
  let job = await queue.publish<FromScratchResult>({
    jobType: 'from-scratch-index',
    concurrencyGroup: `indexing:${realmUrl}`,
    timeout: FROM_SCRATCH_JOB_TIMEOUT_SEC,
    priority,
    args,
  });
  return job;
}
