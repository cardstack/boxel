import type {
  DBAdapter,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import { ensureTrailingSlash, param, query } from '@cardstack/runtime-common';
import { pathExistsSync, readdirSync, removeSync } from 'fs-extra';
import { join } from 'path';

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
        let relativePath = fullPath.replace(basePath, '').replace(/^[/\\]/, '');
        if (relativePath) {
          allPaths.push(relativePath);
        }
      }
    }
  }

  traverseDirectory(realmPath, realmPath);
  return allPaths;
}

export async function removeMountedRealm(args: {
  realm: Realm;
  realmPath: string;
  realms: Realm[];
  virtualNetwork: VirtualNetwork;
}) {
  let { realm, realmPath, realms, virtualNetwork } = args;
  let cleanupError: Error | undefined;

  try {
    let allFilePaths = collectAllFilePaths(realmPath);
    if (allFilePaths.length > 0) {
      await realm.deleteAll(allFilePaths);
    }

    if (pathExistsSync(realmPath)) {
      removeSync(realmPath);
    }
  } catch (error) {
    cleanupError =
      error instanceof Error
        ? error
        : new Error(`Failed to remove realm at ${realmPath}: ${String(error)}`);
  }

  try {
    virtualNetwork.unmount(realm.handle);
  } catch (error) {
    cleanupError ??=
      error instanceof Error
        ? error
        : new Error(`Failed to unmount realm ${realm.url}: ${String(error)}`);
  }

  let realmIndex = realms.findIndex(
    (candidate) =>
      ensureTrailingSlash(candidate.url) === ensureTrailingSlash(realm.url),
  );
  if (realmIndex !== -1) {
    realms.splice(realmIndex, 1);
  }

  if (cleanupError) {
    throw cleanupError;
  }
}

export function destroyMountedRealm(args: {
  realm: Realm;
  realmPath: string;
  realms: Realm[];
  virtualNetwork: VirtualNetwork;
}) {
  let { realm, realmPath, realms, virtualNetwork } = args;
  let cleanupError: Error | undefined;

  try {
    if (pathExistsSync(realmPath)) {
      removeSync(realmPath);
    }
  } catch (error) {
    cleanupError =
      error instanceof Error
        ? error
        : new Error(`Failed to remove realm at ${realmPath}: ${String(error)}`);
  }

  try {
    virtualNetwork.unmount(realm.handle);
  } catch (error) {
    cleanupError ??=
      error instanceof Error
        ? error
        : new Error(`Failed to unmount realm ${realm.url}: ${String(error)}`);
  }

  let realmIndex = realms.findIndex(
    (candidate) =>
      ensureTrailingSlash(candidate.url) === ensureTrailingSlash(realm.url),
  );
  if (realmIndex !== -1) {
    realms.splice(realmIndex, 1);
  }

  if (cleanupError) {
    throw cleanupError;
  }
}

export async function removeRealmDatabaseArtifacts(args: {
  dbAdapter: DBAdapter;
  realmURL: string;
}) {
  let { dbAdapter, realmURL } = args;
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
