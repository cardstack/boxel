import type { DBAdapter, Expression, Querier } from '@cardstack/runtime-common';
import {
  addExplicitParens,
  cancelRunningJobsInConcurrencyGroup,
  dbAdapterQuerier,
  param,
  separatedByCommas,
} from '@cardstack/runtime-common';
import fsExtra from 'fs-extra';
const { pathExistsSync, readdirSync, removeSync } = fsExtra;
import { join, relative } from 'path';

// Walk a realm's on-disk directory and return every file's path relative
// to the realm root. Used by the unpublish handler to drive tombstone
// inserts via Realm.deleteAll() before the directory is removed.
export function collectAllFilePaths(realmPath: string): string[] {
  let allPaths: string[] = [];

  function traverseDirectory(currentPath: string, basePath: string) {
    if (!pathExistsSync(currentPath)) {
      return;
    }

    let entries;
    try {
      entries = readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (let entry of entries) {
      let fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        traverseDirectory(fullPath, basePath);
      } else {
        let relativePath = relative(basePath, fullPath).replace(/\\/g, '/');
        if (relativePath) {
          allPaths.push(relativePath);
        }
      }
    }
  }

  traverseDirectory(realmPath, realmPath);
  return allPaths;
}

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
  querier?: Querier;
}) {
  let { dbAdapter, realmURL, querier } = args;
  let q = querier ?? dbAdapterQuerier(dbAdapter);
  await cancelRunningJobsInConcurrencyGroup(
    dbAdapter,
    `indexing:${realmURL}`,
    q,
  );

  let pendingJobs = (await q([
    `SELECT id FROM jobs WHERE concurrency_group =`,
    param(`indexing:${realmURL}`),
    ` AND status = 'unfulfilled'`,
  ])) as { id: number }[];

  if (pendingJobs.length > 0) {
    let jobIdList: Expression[] = pendingJobs.map(({ id }) => [param(id)]);
    // separatedByCommas/addExplicitParens overload resolution picks the wider
    // CardExpression overload first, so we cast back to Expression for the
    // Querier (which only accepts Expression).
    await q([
      `DELETE FROM job_reservations WHERE job_id IN`,
      ...(addExplicitParens(separatedByCommas(jobIdList)) as Expression),
    ]);
  }

  await q([
    `DELETE FROM jobs WHERE concurrency_group =`,
    param(`indexing:${realmURL}`),
    ` AND status = 'unfulfilled'`,
  ]);
  await q([`DELETE FROM modules WHERE resolved_realm_url =`, param(realmURL)]);
  await q([
    `DELETE FROM boxel_index_working WHERE realm_url =`,
    param(realmURL),
  ]);
  await q([`DELETE FROM boxel_index WHERE realm_url =`, param(realmURL)]);
  await q([`DELETE FROM realm_meta WHERE realm_url =`, param(realmURL)]);
  await q([`DELETE FROM realm_generations WHERE realm_url =`, param(realmURL)]);
  await q([`DELETE FROM realm_file_meta WHERE realm_url =`, param(realmURL)]);
  await q([`DELETE FROM realm_metadata WHERE url =`, param(realmURL)]);
}
