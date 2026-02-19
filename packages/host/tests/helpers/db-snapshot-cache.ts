const cache = new Map<string, string>();

export function getCachedSnapshot(key: string): string | undefined {
  return cache.get(key);
}

export function setCachedSnapshot(key: string, snapshotName: string): void {
  cache.set(key, snapshotName);
}
