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
    // allow this to run longer than normal as we are forcing all files to be
    // revisited regardless of mtime
    timeout: 6 * 60,
    priority,
    args,
  });
  return job;
}
