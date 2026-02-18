import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { tracked, cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import isEqual from 'lodash/isEqual';
import { TrackedArray } from 'tracked-built-ins';

import type {
  QueryResultsMeta,
  ErrorEntry,
  CardResource,
  FileMetaResource,
  Saved,
} from '@cardstack/runtime-common';
import {
  subscribeToRealm,
  logger as runtimeLogger,
  normalizeQueryForSignature,
  buildQueryParamValue,
} from '@cardstack/runtime-common';
import type { DataQuery } from '@cardstack/runtime-common/query';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

const waiter = buildWaiter('search-data-resource:search-waiter');

export interface SearchDataArgs {
  named: {
    query: DataQuery | undefined;
    realms: string[] | undefined;
    isLive: boolean;
    owner: Owner;
  };
}

export class SearchDataResource extends Resource<SearchDataArgs> {
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;
  @tracked private realmsToSearch: string[] = [];
  // @ts-ignore we use this.loaded for test instrumentation.
  private loaded: Promise<void> | undefined;
  private subscriptions: { url: string; unsubscribe: () => void }[] = [];
  private _resources = new TrackedArray<
    CardResource<Saved> | FileMetaResource
  >();
  @tracked private _meta: QueryResultsMeta = { page: { total: 0 } };
  @tracked private _errors: ErrorEntry[] | undefined;
  #isLive = false;
  #previousQuery: DataQuery | undefined;
  #previousQueryString: string | undefined;
  #previousRealms: string[] | undefined;
  #log = runtimeLogger('search-data-resource');

  constructor(owner: object) {
    super(owner);
    registerDestructor(this, () => {
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }
    });
  }

  modify(_positional: never[], named: SearchDataArgs['named']) {
    let { query, realms, isLive, owner } = named;

    setOwner(this, owner);

    if (query === undefined) {
      return;
    }

    this.#log.info(
      `modify: query present; isLive=${isLive}; realms=${realms?.join(',') ?? '(default)'}`,
    );
    this.#isLive = isLive;
    this.realmsToSearch =
      realms === undefined || realms.length === 0
        ? this.realmServer.availableRealmURLs
        : realms;

    if (
      isLive &&
      (this.subscriptions.length === 0 ||
        !isEqual(realms, this.#previousRealms))
    ) {
      this.#log.info(
        `subscribing to realms for search data resource; realms=${this.realmsToSearch.join(',')}`,
      );
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }
      this.subscriptions = this.realmsToSearch.map((realm) => {
        this.#log.info(
          `search-data-resource calling subscribeToRealm for ${realm}`,
        );
        return {
          url: `${realm}_message`,
          unsubscribe: subscribeToRealm(realm, (event: RealmEventContent) => {
            this.#log.info(
              `search-data-resource received realm event on ${realm}: ${JSON.stringify(event)}`,
            );
            if (this.#previousQuery === undefined) {
              return;
            }
            if (
              event.eventName !== 'index' ||
              ('indexType' in event && event.indexType !== 'incremental')
            ) {
              return;
            }
            this.search.perform(this.#previousQuery);
          }),
        };
      });
    }

    let queryString = buildQueryParamValue(normalizeQueryForSignature(query));
    if (
      isEqual(queryString, this.#previousQueryString) &&
      isEqual(realms, this.#previousRealms)
    ) {
      this.#log.info(
        `skip search perform as query and realms have not changed; query=${queryString}; realms=${this.realmsToSearch.join(
          ',',
        )}`,
      );
      return;
    }

    this.#previousRealms = realms;
    this.#previousQuery = query;
    this.#previousQueryString = queryString;
    this.loaded = this.search.perform(query);
  }

  get isLoading() {
    return this.search.isRunning;
  }
  get isLive() {
    return this.#isLive;
  }
  get resources() {
    return this._resources;
  }
  @cached
  get meta() {
    return this._meta;
  }
  @cached
  get errors() {
    return this._errors;
  }

  private search = restartableTask(async (query: DataQuery) => {
    this.#log.info(
      `search task start; realms=${this.realmsToSearch.join(',')}; query=${JSON.stringify(query)}`,
    );
    let token = waiter.beginAsync();
    try {
      let { resources, meta } = await this.store.search(
        query,
        this.realmsToSearch,
        { includeMeta: true },
      );
      this.#log.info(
        `search task complete; total resources=${resources.length}; ids=${resources
          .map((r) => r.id)
          .join(',')}`,
      );
      this._meta = meta;
      this._errors = undefined;
      this._resources.splice(0, this._resources.length, ...resources);
    } finally {
      waiter.endAsync(token);
    }
  });
}

export function getSearchData(
  parent: object,
  owner: Owner,
  getQuery: () => DataQuery | undefined,
  getRealms?: () => string[] | undefined,
  opts?: {
    isLive?: boolean;
  },
) {
  let resource = SearchDataResource.from(parent, () => ({
    named: {
      query: getQuery(),
      realms: getRealms ? getRealms() : undefined,
      isLive: opts?.isLive != null ? opts.isLive : false,
      owner,
    },
  }));
  return resource;
}
