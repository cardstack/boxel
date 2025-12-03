import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
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
  @tracked error: unknown;
  @tracked realmHref: string | undefined;
  @tracked searchURL: string | undefined;
  @tracked private stale = true;
  @tracked private hasFetched = false;

  #options: LiveQueryOptions<T>;
  #isDestroyed = false;

  constructor(options: LiveQueryOptions<T>) {
    this.#options = options;
    let hasSeed = options.seedRecords !== undefined;
    this.records = new TrackedArray(options.seedRecords ?? []);
    this.realmHref = options.seedRealmHref;
    this.searchURL = options.seedSearchURL;
    this.error = undefined;
    this.stale = !hasSeed;
    this.hasFetched = hasSeed;
    if (options.autoRefresh !== false && !hasSeed) {
      void this.refresh({ force: true });
    }
  }

  get status(): LiveQueryStatus {
    if (this.refreshTask.isRunning) {
      return 'loading';
    }
    if (this.error) {
      return 'error';
    }
    if (!this.hasFetched) {
      return this.records.length > 0 ? 'ready' : 'idle';
    }
    return this.stale ? 'idle' : 'ready';
  }

  get owner(): LiveQueryOwner | undefined {
    return this.#options.owner;
  }

  get isStale(): boolean {
    return this.stale;
  }

  get isDestroyed(): boolean {
    return this.#isDestroyed;
  }

  markStale(): boolean {
    if (this.#isDestroyed) {
      return false;
    }
    if (this.stale) {
      return false;
    }
    this.stale = true;
    return true;
  }

  async refresh(opts?: { force?: boolean }): Promise<void> {
    if (this.#isDestroyed) {
      return;
    }
    return (await this.refreshTask.perform(opts?.force ?? false)) as void;
  }

  destroy(): void {
    if (this.#isDestroyed) {
      return;
    }
    this.#isDestroyed = true;
    this.records.splice(0, this.records.length);
    this.refreshTask.cancelAll();
  }

  private refreshTask = restartableTask(async (force?: boolean) => {
    if (this.#isDestroyed) {
      return;
    }
    let searchArgs = this.#options.getSearchURL();
    if (!searchArgs) {
      this.#handleNoSearchArgs();
      return;
    }
    if (!force && !this.stale && this.searchURL === searchArgs.searchURL) {
      return;
    }
    this.error = undefined;
    this.#options.onRefreshStart?.();
    try {
      let records = await this.#options.fetchRecords(searchArgs);
      if (this.#isDestroyed) {
        return;
      }
      this.#applyResults(records, searchArgs.realmHref, searchArgs.searchURL);
      this.stale = false;
      this.hasFetched = true;
    } catch (error) {
      if (this.#isDestroyed) {
        return;
      }
      this.error = error;
      this.stale = true;
      this.hasFetched = true;
      throw error;
    } finally {
      this.#options.onRefreshEnd?.({ error: this.error });
    }
  });

  #handleNoSearchArgs(): void {
    this.records.splice(0, this.records.length);
    this.realmHref = undefined;
    this.searchURL = undefined;
    this.error = undefined;
    this.stale = false;
    this.hasFetched = true;
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
}
