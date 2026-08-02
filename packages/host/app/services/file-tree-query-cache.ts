import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import type { SearchEntryWireQuery } from '@cardstack/runtime-common';

import type SessionService from '@cardstack/host/services/session';
import type StoreService from '@cardstack/host/services/store';

const maxCachedQueries = 32;

interface QueryEntry {
  fileURLs: readonly string[];
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJSON(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// Filtered file pickers repeatedly ask the index for the same lean URL list.
// Keep those lists for the authenticated session so opening a chooser can
// render synchronously, then let realm index events refresh the cached value
// in the background. The bound prevents a long cross-realm session from
// retaining every ad-hoc filter an extension ever constructed.
export default class FileTreeQueryCacheService extends Service {
  @service declare private session: SessionService;
  @service declare private store: StoreService;

  private entries = new Map<string, QueryEntry>();
  private pending = new Map<string, Promise<readonly string[]>>();

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  peek(
    realmURL: string,
    query: SearchEntryWireQuery,
  ): readonly string[] | undefined {
    let key = this.keyFor(realmURL, query);
    let entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.fileURLs;
  }

  load(
    realmURL: string,
    query: SearchEntryWireQuery,
    options: { force?: boolean } = {},
  ): Promise<readonly string[]> {
    let key = this.keyFor(realmURL, query);
    if (!options.force) {
      let cached = this.peek(realmURL, query);
      if (cached) {
        return Promise.resolve(cached);
      }
      let existing = this.pending.get(key);
      if (existing) {
        return existing;
      }
    }

    let pending = this.fetch(realmURL, query).finally(() => {
      if (this.pending.get(key) === pending) {
        this.pending.delete(key);
      }
    });
    this.pending.set(key, pending);
    return pending;
  }

  prefetch(realmURL: string, query: SearchEntryWireQuery): void {
    void this.load(realmURL, query).catch(() => {
      // Prewarming is optional. The chooser resource owns visible failures.
    });
  }

  resetState() {
    this.entries.clear();
    this.pending.clear();
  }

  willDestroy() {
    this.resetState();
    super.willDestroy();
  }

  private async fetch(
    realmURL: string,
    query: SearchEntryWireQuery,
  ): Promise<readonly string[]> {
    let { data } = await this.store.searchEntries(query, [realmURL]);
    let fileURLs = Object.freeze(
      data
        .map((entry) => entry.id)
        .filter((id): id is string => typeof id === 'string'),
    );
    let key = this.keyFor(realmURL, query);
    this.entries.delete(key);
    this.entries.set(key, { fileURLs });
    while (this.entries.size > maxCachedQueries) {
      let oldest = this.entries.keys().next().value as string | undefined;
      if (oldest == null) {
        break;
      }
      this.entries.delete(oldest);
    }
    return fileURLs;
  }

  private keyFor(realmURL: string, query: SearchEntryWireQuery): string {
    return `${new URL(realmURL).href}|${canonicalJSON(query)}`;
  }
}

declare module '@ember/service' {
  interface Registry {
    'file-tree-query-cache': FileTreeQueryCacheService;
  }
}
