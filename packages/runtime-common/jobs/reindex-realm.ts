import {
  DBAdapter,
  FromScratchArgs,
  FromScratchResult,
  QueuePublisher,
  Realm,
  param,
  query,
} from 'index';

export async function enqueueReindexRealmJob(
  realm: Realm,
  queue: QueuePublisher,
  dbAdapter: DBAdapter,
  priority: number,
) {
  let realmUsername = await realm.getRealmOwnerUsername();
  let args: FromScratchArgs = {
    realmURL: realm.url,
    realmUsername,
  };
  await query(dbAdapter, [
    `UPDATE boxel_index SET last_modified = NULL WHERE realm_url =`,
    param(realm.url),
  ]);
  let job = await queue.publish<FromScratchResult>({
    jobType: `from-scratch-index`,
    concurrencyGroup: `indexing:${realm.url}`,
    // allow this to run longer than normal as we are forcing all files to be
    // revisited regardless of mtime
    timeout: 6 * 60,
    priority,
    args,
  });
  return job;
}
