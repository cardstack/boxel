import type { DBAdapter, QueuePublisher } from '../';
import { param, query } from '../';
import {
  FROM_SCRATCH_JOB_TIMEOUT_SEC,
  type FromScratchResult,
} from '../tasks/indexer';

export async function enqueueReindexRealmJob(
  realmUrl: string,
  realmUsername: string,
  queue: QueuePublisher,
  dbAdapter: DBAdapter,
  priority: number,
) {
  let args = {
    realmURL: realmUrl,
    realmUsername,
  };
  await query(dbAdapter, [
    `UPDATE boxel_index SET last_modified = NULL WHERE realm_url =`,
    param(realmUrl),
  ]);
  let job = await queue.publish<FromScratchResult>({
    jobType: 'from-scratch-index',
    concurrencyGroup: `indexing:${realmUrl}`,
    timeout: FROM_SCRATCH_JOB_TIMEOUT_SEC,
    priority,
    args,
  });
  return job;
}
