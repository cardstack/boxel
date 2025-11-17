import { tracked } from '@glimmer/tracking';

import { TrackedArray } from 'tracked-built-ins';

import type { CardDef } from 'https://cardstack.com/base/card-api';

export type LiveQueryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LiveQueryOwner {
  instance: CardDef;
  fieldName: string;
}

export interface LiveQuerySearchArgs {
  realmHref: string;
  searchURL: string;
}

export type FetchLiveQueryRecords<T extends CardDef = CardDef> = (
  args: LiveQuerySearchArgs,
) => Promise<T[]>;

export interface LiveQueryOptions<T extends CardDef = CardDef> {
  getSearchURL: () => LiveQuerySearchArgs | undefined;
  fetchRecords: FetchLiveQueryRecords<T>;
  owner?: LiveQueryOwner;
  seedRecords?: T[];
  seedRealmHref?: string;
  seedSearchURL?: string;
  autoRefresh?: boolean;
  onRefreshStart?: () => void;
  onRefreshEnd?: (result: { error?: unknown }) => void;
}

export type LiveQueryCreationOptions<T extends CardDef = CardDef> = Omit<
  LiveQueryOptions<T>,
  'fetchRecords'
>;

export default class LiveQuery<T extends CardDef = CardDef> {
  readonly records: TrackedArray<T>;
  get record(): T | null {
    return this.records[0] ?? null;
  }
  @tracked status: LiveQueryStatus;
  @tracked error: unknown;
  @tracked realmHref: string | undefined;
  @tracked searchURL: string | undefined;

  #options: LiveQueryOptions<T>;
  #pending?: Promise<void>;
  #stale = true;
  #isDestroyed = false;

  constructor(options: LiveQueryOptions<T>) {
    this.#options = options;
    let hasSeed = options.seedRecords !== undefined;
    this.records = new TrackedArray(options.seedRecords ?? []);
    this.realmHref = options.seedRealmHref;
    this.searchURL = options.seedSearchURL;
    this.status = hasSeed ? 'ready' : 'idle';
    this.error = undefined;
    this.#stale = !hasSeed;
    if (options.autoRefresh !== false && !hasSeed) {
      void this.refresh({ force: true });
    }
  }

  get owner(): LiveQueryOwner | undefined {
    return this.#options.owner;
  }

  get isDestroyed(): boolean {
    return this.#isDestroyed;
  }

  markStale(): boolean {
    if (this.#isDestroyed) {
      return false;
    }
    if (this.#stale) {
      return false;
    }
    this.#stale = true;
    if (this.status === 'ready') {
      this.#setStatus('idle');
    }
    return true;
  }

  async refresh(opts?: { force?: boolean }): Promise<void> {
    if (this.#isDestroyed) {
      return;
    }
    let force = opts?.force ?? false;
    if (this.#pending) {
      return this.#pending;
    }
    let promise = this.#performRefresh(force);
    this.#pending = promise.finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  destroy(): void {
    if (this.#isDestroyed) {
      return;
    }
    this.#isDestroyed = true;
    this.records.splice(0, this.records.length);
    this.#pending = undefined;
  }

  async #performRefresh(force: boolean): Promise<void> {
    let searchArgs = this.#options.getSearchURL();
    if (!searchArgs) {
      this.#handleNoSearchArgs();
      return;
    }
    if (!force && !this.#stale && this.searchURL === searchArgs.searchURL) {
      return;
    }
    this.#setStatus('loading');
    this.error = undefined;
    this.#options.onRefreshStart?.();
    try {
      let records = await this.#options.fetchRecords(searchArgs);
      if (this.#isDestroyed) {
        return;
      }
      this.#applyResults(records, searchArgs.realmHref, searchArgs.searchURL);
      this.#setStatus('ready');
      this.#stale = false;
    } catch (error) {
      if (this.#isDestroyed) {
        return;
      }
      this.error = error;
      this.#setStatus('error');
      this.#stale = true;
      throw error;
    } finally {
      this.#options.onRefreshEnd?.({ error: this.error });
    }
  }

  #handleNoSearchArgs(): void {
    this.records.splice(0, this.records.length);
    this.realmHref = undefined;
    this.searchURL = undefined;
    this.error = undefined;
    this.#stale = false;
    this.#setStatus('idle');
  }

  #applyResults(
    records: T[],
    realmHref: string | undefined,
    searchURL: string | undefined,
  ): void {
    this.records.splice(0, this.records.length, ...records);
    this.realmHref = realmHref;
    this.searchURL = searchURL;
  }

  #setStatus(next: LiveQueryStatus): void {
    if (this.status !== next) {
      this.status = next;
    }
  }
}
