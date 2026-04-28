import type { DBAdapter } from '@cardstack/runtime-common';
import {
  cancelRunningJobsInConcurrencyGroup,
  param,
  query,
} from '@cardstack/runtime-common';
import { pathExistsSync, removeSync } from 'fs-extra';

// Phase 3 PR 2: handlers stop touching mount state. This util is a
// pure FS removal — `rm -rf` against the realm directory. The realm-
// registry DELETE that the caller performs in the same transaction
// emits a realm_registry NOTIFY; the reconciler on every instance
// (including the origin) reacts to that NOTIFY by unmounting the
// realm and unsubscribing it. Handlers no longer need to call
// `virtualNetwork.unmount`, `realms.splice`, or `realm.unsubscribe`.
//
// Per-file `realm.deleteAll(...)` is also gone: the previous
// implementation broadcast Matrix `realm-event:remove` messages for
// each file, but those events were a side-effect of the old
// handler-owned mount lifecycle. Subscribers that care about realm
// removal can listen to the realm_registry NOTIFY directly (or its
// downstream effect — reconciler → virtualNetwork.unmount).
export function removeRealmFiles(realmPath: string): void {
  if (pathExistsSync(realmPath)) {
    removeSync(realmPath);
  }
}

export async function removeRealmDatabaseArtifacts(args: {
  dbAdapter: DBAdapter;
  realmURL: string;
}) {
  let { dbAdapter, realmURL } = args;
  await cancelRunningJobsInConcurrencyGroup(dbAdapter, `indexing:${realmURL}`);

  let pendingJobs = (await query(dbAdapter, [
    `SELECT id FROM jobs WHERE concurrency_group =`,
    param(`indexing:${realmURL}`),
    ` AND status = 'unfulfilled'`,
  ])) as { id: number }[];

  if (pendingJobs.length > 0) {
    await query(dbAdapter, [
      `DELETE FROM job_reservations WHERE job_id IN (${pendingJobs
        .map(({ id }) => id)
        .join(', ')})`,
    ]);
  }

  await query(dbAdapter, [
    `DELETE FROM jobs WHERE concurrency_group =`,
    param(`indexing:${realmURL}`),
    ` AND status = 'unfulfilled'`,
  ]);
  await query(dbAdapter, [
    `DELETE FROM modules WHERE resolved_realm_url =`,
    param(realmURL),
  ]);
  await query(dbAdapter, [
    `DELETE FROM boxel_index_working WHERE realm_url =`,
    param(realmURL),
  ]);
  await query(dbAdapter, [
    `DELETE FROM boxel_index WHERE realm_url =`,
    param(realmURL),
  ]);
  await query(dbAdapter, [
    `DELETE FROM realm_meta WHERE realm_url =`,
    param(realmURL),
  ]);
  await query(dbAdapter, [
    `DELETE FROM realm_versions WHERE realm_url =`,
    param(realmURL),
  ]);
  await query(dbAdapter, [
    `DELETE FROM realm_file_meta WHERE realm_url =`,
    param(realmURL),
  ]);
  await query(dbAdapter, [
    `DELETE FROM session_rooms WHERE realm_url =`,
    param(realmURL),
  ]);
}
