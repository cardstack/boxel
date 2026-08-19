import type { SyncManifest } from './sync-manifest.ts';

export type SideStatus = 'unchanged' | 'changed' | 'added' | 'deleted';
export type SyncAction =
  | 'push'
  | 'pull'
  | 'push-delete'
  | 'pull-delete'
  | 'conflict'
  | 'noop';

export interface FileClassification {
  relativePath: string;
  localStatus: SideStatus;
  remoteStatus: SideStatus;
  action: SyncAction;
}

export type ConflictStrategy =
  | 'prefer-local'
  | 'prefer-remote'
  | 'prefer-newest';

export interface SyncOptions {
  deleteSync?: boolean;
  preferLocal?: boolean;
  preferRemote?: boolean;
}

export function classifyLocal(
  relativePath: string,
  localHashes: Map<string, string>,
  manifest: SyncManifest | null,
): SideStatus {
  const hasLocal = localHashes.has(relativePath);
  const inManifest = manifest?.files[relativePath] !== undefined;

  if (hasLocal && inManifest) {
    return localHashes.get(relativePath) === manifest!.files[relativePath]
      ? 'unchanged'
      : 'changed';
  }
  if (hasLocal && !inManifest) return 'added';
  if (!hasLocal && inManifest) return 'deleted';
  // Not local, not in manifest — this file only exists remotely
  return 'unchanged'; // not relevant on local side
}

export function classifyRemote(
  relativePath: string,
  remoteMtimes: Map<string, number>,
  manifest: SyncManifest | null,
): SideStatus {
  const hasRemote = remoteMtimes.has(relativePath);
  const inManifestMtimes = manifest?.remoteMtimes?.[relativePath] !== undefined;
  // Use manifest.files as secondary known-paths set when remoteMtimes is missing
  const inManifestFiles = manifest?.files[relativePath] !== undefined;
  const knownInManifest = inManifestMtimes || inManifestFiles;

  if (hasRemote && inManifestMtimes) {
    return remoteMtimes.get(relativePath) ===
      manifest!.remoteMtimes![relativePath]
      ? 'unchanged'
      : 'changed';
  }
  // Known in manifest.files but no mtime to compare — treat as changed, not added
  if (hasRemote && inManifestFiles) return 'changed';
  if (hasRemote && !knownInManifest) return 'added';
  if (!hasRemote && knownInManifest) return 'deleted';
  // Not remote, not in manifest — only exists locally
  return 'unchanged'; // not relevant on remote side
}

export function determineAction(
  local: SideStatus,
  remote: SideStatus,
  syncOptions: SyncOptions,
): SyncAction {
  // Both unchanged
  if (local === 'unchanged' && remote === 'unchanged') return 'noop';

  // One side changed, other unchanged
  if (local === 'changed' && remote === 'unchanged') return 'push';
  if (local === 'unchanged' && remote === 'changed') return 'pull';

  // One side added, other doesn't exist
  if (local === 'added' && remote === 'unchanged') return 'push';
  if (local === 'unchanged' && remote === 'added') return 'pull';

  // Both changed or both added — conflict
  if (
    (local === 'changed' && remote === 'changed') ||
    (local === 'added' && remote === 'added')
  ) {
    return 'conflict';
  }

  // Cross-state conflicts (e.g., manifest missing remoteMtimes)
  if (
    (local === 'changed' && remote === 'added') ||
    (local === 'added' && remote === 'changed')
  ) {
    return 'conflict';
  }

  // Deletions
  if (local === 'deleted' && remote === 'unchanged') {
    return syncOptions.deleteSync || syncOptions.preferLocal
      ? 'push-delete'
      : 'noop';
  }
  if (local === 'unchanged' && remote === 'deleted') {
    return syncOptions.deleteSync || syncOptions.preferRemote
      ? 'pull-delete'
      : 'noop';
  }

  // Delete vs change conflicts
  if (local === 'deleted' && remote === 'changed') return 'conflict';
  if (local === 'changed' && remote === 'deleted') return 'conflict';

  // Both deleted
  if (local === 'deleted' && remote === 'deleted') return 'noop';

  // Added vs deleted (shouldn't normally happen but handle gracefully)
  if (local === 'added' && remote === 'deleted') return 'push';
  if (local === 'deleted' && remote === 'added') return 'pull';

  return 'noop';
}

export function resolveConflict(
  classification: FileClassification,
  localFilesWithMtimes: Map<string, { path: string; mtime: number }>,
  remoteMtimes: Map<string, number>,
  strategy: ConflictStrategy | null,
): SyncAction | null {
  const { localStatus, remoteStatus, relativePath } = classification;

  if (!strategy) return null; // skip — no strategy

  switch (strategy) {
    case 'prefer-local':
      if (localStatus === 'deleted') return 'push-delete';
      return 'push';

    case 'prefer-remote':
      if (remoteStatus === 'deleted') return 'pull-delete';
      return 'pull';

    case 'prefer-newest': {
      // For delete-vs-change, the change always wins
      if (localStatus === 'deleted' && remoteStatus === 'changed')
        return 'pull';
      if (localStatus === 'changed' && remoteStatus === 'deleted')
        return 'push';

      const localInfo = localFilesWithMtimes.get(relativePath);
      const remoteMtime = remoteMtimes.get(relativePath);

      if (localInfo && remoteMtime !== undefined) {
        // Remote mtimes are in seconds (epoch), local mtimes are in ms
        return localInfo.mtime > remoteMtime * 1000 ? 'push' : 'pull';
      }
      // If we can't compare, prefer local (it's what the user has)
      return 'push';
    }
  }
}
