import { FROM_SCRATCH_JOB_TIMEOUT_SEC } from '../tasks/indexer';
import type {
  DBAdapter,
  FromScratchArgs,
  FromScratchResult,
  QueuePublisher,
} from '../';
import { param, query } from '../';

export async function enqueueReindexRealmJob(
  realmUrl: string,
  realmUsername: string,
  queue: QueuePublisher,
  dbAdapter: DBAdapter,
  priority: number,
) {
  let args: FromScratchArgs = {
    realmURL: realmUrl,
    realmUsername,
  };
  await query(dbAdapter, [
    `UPDATE boxel_index SET last_modified = NULL WHERE realm_url =`,
    param(realmUrl),
  ]);
  let job = await queue.publish<FromScratchResult>({
    jobType: `from-scratch-index`,
    concurrencyGroup: `indexing:${realmUrl}`,
    timeout: FROM_SCRATCH_JOB_TIMEOUT_SEC,
    priority,
    args,
  });
  return job;
}
