import type { LocalPath, RealmPaths } from '../paths';
import { executableExtensions } from '../index';

const importSpecifierExpression =
  /(?:import|export)\s+(?:[^'"`]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

export interface CachedModuleDependencyEntry {
  canonicalPath: LocalPath;
  dependencyKeys: Set<string>;
}

export function moduleDependencyKey(localPath: LocalPath): string {
  for (let extension of executableExtensions) {
    if (localPath.endsWith(extension)) {
      return localPath.slice(0, -extension.length);
    }
  }
  return localPath;
}

export function collectDependentModuleCacheInvalidations(
  changedDependencyKeys: Set<string>,
  cacheEntries: Iterable<CachedModuleDependencyEntry>,
): Set<LocalPath> {
  if (changedDependencyKeys.size === 0) {
    return new Set();
  }
  let depsByCanonicalPath = new Map<LocalPath, Set<string>>();
  for (let cachedEntry of cacheEntries) {
    if (!depsByCanonicalPath.has(cachedEntry.canonicalPath)) {
      depsByCanonicalPath.set(
        cachedEntry.canonicalPath,
        cachedEntry.dependencyKeys,
      );
    }
  }

  let invalidated = new Set<LocalPath>();
  let seenDependencyKeys = new Set(changedDependencyKeys);
  let pendingDependencyKeys = [...changedDependencyKeys];
  while (pendingDependencyKeys.length > 0) {
    let changedDependencyKey = pendingDependencyKeys.pop()!;
    for (let [modulePath, moduleDeps] of depsByCanonicalPath) {
      if (
        invalidated.has(modulePath) ||
        !moduleDeps.has(changedDependencyKey)
      ) {
        continue;
      }
      invalidated.add(modulePath);
      let dependencyKey = moduleDependencyKey(modulePath);
      if (!seenDependencyKeys.has(dependencyKey)) {
        seenDependencyKeys.add(dependencyKey);
        pendingDependencyKeys.push(dependencyKey);
      }
    }
  }
  return invalidated;
}

export function extractModuleDependencyKeys(
  source: string,
  canonicalPath: LocalPath,
  realmURL: string,
  paths: RealmPaths,
): Set<string> {
  let dependencies = new Set<string>();
  let moduleURL = paths.fileURL(canonicalPath).href;
  let match: RegExpExecArray | null;
  while ((match = importSpecifierExpression.exec(source))) {
    let specifier = match[1] ?? match[2];
    if (!specifier) {
      continue;
    }
    try {
      let resolvedURL = new URL(specifier, moduleURL);
      if (!resolvedURL.href.startsWith(realmURL)) {
        continue;
      }
      dependencies.add(moduleDependencyKey(paths.local(resolvedURL)));
    } catch (_err) {
      // ignore unresolvable import specifiers
    }
  }
  return dependencies;
}
