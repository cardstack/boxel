import type { Realm, VirtualNetwork } from '@cardstack/runtime-common';
import { ensureTrailingSlash } from '@cardstack/runtime-common';
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
