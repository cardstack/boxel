import type { DBAdapter, QueuePublisher } from '../';
import { param, query } from '../';
import {
  FROM_SCRATCH_JOB_TIMEOUT_SEC,
  type FromScratchResult,
} from '../tasks/indexer';

interface EnqueueReindexRealmJobOptions {
  clearLastModified?: boolean;
}

export async function enqueueReindexRealmJob(
  realmUrl: string,
  realmUsername: string,
  queue: QueuePublisher,
  dbAdapter: DBAdapter,
  priority: number,
  opts?: EnqueueReindexRealmJobOptions,
) {
  let args = {
    realmURL: realmUrl,
    realmUsername,
  };
  if (opts?.clearLastModified) {
    await query(dbAdapter, [
      `UPDATE boxel_index SET last_modified = NULL WHERE realm_url =`,
      param(realmUrl),
    ]);
    let countRows = await query(dbAdapter, [
      `SELECT COUNT(*)::int AS n FROM boxel_index WHERE realm_url =`,
      param(realmUrl),
      `AND last_modified IS NULL`,
    ]);
    let count = (countRows[0] as { n?: number } | undefined)?.n ?? -1;
    console.log(
      `[ogtitle-diag] event=clearLastModified-applied realmURL=${realmUrl} rowsWithNullLastModified=${count}`,
    );
  } else {
    console.log(
      `[ogtitle-diag] event=clearLastModified-skipped realmURL=${realmUrl}`,
    );
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
