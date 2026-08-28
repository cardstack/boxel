// Keep aligned with packages/boxel-cli/src/lib/sync-logic.ts.
// This copy is dependency-free so the native prototype can run without
// importing the CLI package.

export function classifyLocal(relativePath, localHashes, manifest) {
  const hasLocal = localHashes.has(relativePath);
  const inManifest = manifest?.files[relativePath] !== undefined;

  if (hasLocal && inManifest) {
    return localHashes.get(relativePath) === manifest.files[relativePath]
      ? 'unchanged'
      : 'changed';
  }
  if (hasLocal && !inManifest) return 'added';
  if (!hasLocal && inManifest) return 'deleted';
  return 'unchanged';
}

export function classifyRemote(relativePath, remoteMtimes, manifest) {
  const hasRemote = remoteMtimes.has(relativePath);
  const inManifestMtimes = manifest?.remoteMtimes?.[relativePath] !== undefined;
  const inManifestFiles = manifest?.files[relativePath] !== undefined;
  const knownInManifest = inManifestMtimes || inManifestFiles;

  if (hasRemote && inManifestMtimes) {
    return remoteMtimes.get(relativePath) ===
      manifest.remoteMtimes[relativePath]
      ? 'unchanged'
      : 'changed';
  }
  if (hasRemote && inManifestFiles) return 'changed';
  if (hasRemote && !knownInManifest) return 'added';
  if (!hasRemote && knownInManifest) return 'deleted';
  return 'unchanged';
}

export function determineAction(local, remote, syncOptions) {
  if (local === 'unchanged' && remote === 'unchanged') return 'noop';
  if (local === 'changed' && remote === 'unchanged') return 'push';
  if (local === 'unchanged' && remote === 'changed') return 'pull';
  if (local === 'added' && remote === 'unchanged') return 'push';
  if (local === 'unchanged' && remote === 'added') return 'pull';
  if (
    (local === 'changed' && remote === 'changed') ||
    (local === 'added' && remote === 'added')
  ) {
    return 'conflict';
  }
  if (
    (local === 'changed' && remote === 'added') ||
    (local === 'added' && remote === 'changed')
  ) {
    return 'conflict';
  }
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
  if (local === 'deleted' && remote === 'changed') return 'conflict';
  if (local === 'changed' && remote === 'deleted') return 'conflict';
  if (local === 'deleted' && remote === 'deleted') return 'noop';
  if (local === 'added' && remote === 'deleted') return 'push';
  if (local === 'deleted' && remote === 'added') return 'pull';
  return 'noop';
}

export function resolveConflict(
  classification,
  localFilesWithMtimes,
  remoteMtimes,
  strategy,
) {
  const { localStatus, remoteStatus, relativePath } = classification;
  if (!strategy) return null;

  switch (strategy) {
    case 'prefer-local':
      if (localStatus === 'deleted') return 'push-delete';
      return 'push';
    case 'prefer-remote':
      if (remoteStatus === 'deleted') return 'pull-delete';
      return 'pull';
    case 'prefer-newest': {
      if (localStatus === 'deleted' && remoteStatus === 'changed')
        return 'pull';
      if (localStatus === 'changed' && remoteStatus === 'deleted')
        return 'push';
      const localInfo = localFilesWithMtimes.get(relativePath);
      const remoteMtime = remoteMtimes.get(relativePath);
      if (localInfo && remoteMtime !== undefined) {
        return localInfo.mtime > remoteMtime * 1000 ? 'push' : 'pull';
      }
      return 'push';
    }
  }
}

export function planSync({
  localHashes,
  localMtimes,
  remoteMtimes,
  manifest,
  prefer,
  deleteSync = false,
}) {
  const syncOptions = {
    deleteSync,
    preferLocal: prefer === 'local',
    preferRemote: prefer === 'remote',
  };
  const strategy =
    prefer === 'local' || prefer === 'remote' || prefer === 'newest'
      ? prefer === 'newest'
        ? 'prefer-newest'
        : prefer === 'local'
          ? 'prefer-local'
          : 'prefer-remote'
      : null;

  const allPaths = new Set([
    ...localHashes.keys(),
    ...remoteMtimes.keys(),
    ...Object.keys(manifest?.files ?? {}),
    ...Object.keys(manifest?.remoteMtimes ?? {}),
  ]);

  const localFilesWithMtimes = new Map();
  for (const [rel, mtime] of localMtimes) {
    localFilesWithMtimes.set(rel, { path: rel, mtime });
  }

  const plan = [];
  for (const relativePath of allPaths) {
    const localStatus = classifyLocal(relativePath, localHashes, manifest);
    const remoteStatus = classifyRemote(relativePath, remoteMtimes, manifest);
    let action = determineAction(localStatus, remoteStatus, syncOptions);
    if (action === 'conflict') {
      const resolved = resolveConflict(
        { relativePath, localStatus, remoteStatus, action },
        localFilesWithMtimes,
        remoteMtimes,
        strategy,
      );
      action = resolved ?? 'conflict';
    }
    plan.push({ relativePath, localStatus, remoteStatus, action });
  }
  return plan.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
