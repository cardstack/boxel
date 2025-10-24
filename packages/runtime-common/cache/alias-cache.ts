import type { LocalPath } from '../paths';

export interface CanonicalCacheEntry {
  canonicalPath: LocalPath;
}

export class AliasCache<T extends CanonicalCacheEntry> {
  #entries = new Map<LocalPath, T>();
  #aliasesByCanonical = new Map<LocalPath, Set<LocalPath>>();

  get(localPath: LocalPath): T | undefined {
    return this.#entries.get(localPath);
  }

  set(localPath: LocalPath, entry: T): void {
    let existing = this.#entries.get(localPath);
    if (existing) {
      this.#unregister(existing.canonicalPath, localPath);
    }
    this.#entries.set(localPath, entry);
    this.#register(entry.canonicalPath, localPath);
  }

  invalidate(canonicalPath: LocalPath): void {
    let aliases = this.#aliasesByCanonical.get(canonicalPath);
    if (!aliases) {
      return;
    }
    for (let alias of aliases) {
      this.#entries.delete(alias);
    }
    this.#aliasesByCanonical.delete(canonicalPath);
  }

  clear(): void {
    this.#entries.clear();
    this.#aliasesByCanonical.clear();
  }

  #register(canonicalPath: LocalPath, alias: LocalPath): void {
    let aliases = this.#aliasesByCanonical.get(canonicalPath);
    if (!aliases) {
      aliases = new Set();
      this.#aliasesByCanonical.set(canonicalPath, aliases);
    }
    aliases.add(alias);
  }

  #unregister(canonicalPath: LocalPath, alias: LocalPath): void {
    let aliases = this.#aliasesByCanonical.get(canonicalPath);
    if (!aliases) {
      return;
    }
    aliases.delete(alias);
    if (aliases.size === 0) {
      this.#aliasesByCanonical.delete(canonicalPath);
    }
  }
}
