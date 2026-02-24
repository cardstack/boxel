import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { tracked, cached } from '@glimmer/tracking';

import { didCancel, restartableTask, task } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import difference from 'lodash/difference';
import isEqual from 'lodash/isEqual';
import { TrackedArray } from 'tracked-built-ins';

import type {
  QueryResultsMeta,
  ErrorEntry,
  RuntimeDependencyTrackingContext,
} from '@cardstack/runtime-common';
import {
  subscribeToRealm,
  isFileDefInstance,
  logger as runtimeLogger,
  normalizeQueryForSignature,
  buildQueryParamValue,
  parseSearchURL,
  runtimeDependencyContextWithSource,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

const waiter = buildWaiter('search-resource:search-waiter');

export interface Args<T extends CardDef | FileDef = CardDef> {
  named: {
    query: Query | undefined;
    realms: string[] | undefined;
    isLive: boolean;
    isAutoSaved?: boolean;
    storeService?: StoreService;
    doWhileRefreshing?: (() => void) | undefined;
    seed?:
      | {
          cards: T[];
          searchURL?: string;
          realms?: string[];
          meta?: QueryResultsMeta;
          errors?: ErrorEntry[];
          queryErrors?: Array<{
            realm: string;
            type: string;
            message: string;
            status?: number;
          }>;
        }
      | undefined;
    dependencyTracking?: RuntimeDependencyTrackingContext | undefined;
    owner: Owner;
  };
}
export class SearchResource<
  T extends CardDef | FileDef = CardDef,
> extends Resource<Args<T>> {
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;
  #storeServiceOverride: StoreService | undefined;
  @tracked private realmsToSearch: string[] = [];
  // Resist the urge to expose this property publicly as that may entice
  // consumers of this resource to use it in a non-reactive manner (pluck off
  // the instances and throw away the resource).
  // Kept private for tests/internal load bookkeeping.
  private loaded: Promise<void> | undefined;
  private subscriptions: { url: string; unsubscribe: () => void }[] = [];
  private _instances = new TrackedArray<T>();
  @tracked private _meta: QueryResultsMeta = { page: { total: 0 } };
  @tracked private _errors: ErrorEntry[] | undefined;
  #isLive = false;
  #seedApplied = false;
  #doWhileRefreshing: (() => void) | undefined;
  #previousQuery: Query | undefined;
  #previousQueryString: string | undefined;
  #previousRealms: string[] | undefined;
  #dependencyTracking: RuntimeDependencyTrackingContext | undefined;
  #log = runtimeLogger('search-resource');
  #trackedLoadCount = 0;

  private get runtimeStore(): StoreService {
    return this.#storeServiceOverride ?? this.store;
  }

  private trackStoreLoad(
    load: Promise<void> | undefined,
    source: 'seed' | 'search' | 'live-refresh',
  ): void {
    if (!load) {
      return;
    }
    this.loaded = load;
    let loadNumber = ++this.#trackedLoadCount;
    this.#log.info(
      `trackStoreLoad start #${loadNumber} source=${source} query=${this.#previousQueryString ?? '(unknown)'}`,
    );
    this.runtimeStore.trackLoad(load);
    void load
      .finally(() => {
        // Ignore stale completions from superseded loads; keep test-facing
        // `loaded` aligned with the most recent request.
        if (this.loaded !== load) {
          return;
        }
        this.#log.info(
          `trackStoreLoad settled #${loadNumber} source=${source}`,
        );
      })
      .catch((error) => {
        if (didCancel(error)) {
          this.#log.debug(
            `trackStoreLoad canceled #${loadNumber} source=${source}`,
          );
          return;
        }
        this.#log.error(
          `trackStoreLoad rejected #${loadNumber} source=${source}`,
          error,
        );
      });
  }

  constructor(owner: object) {
    super(owner);
    registerDestructor(this, () => {
      for (let instance of this._instances) {
        this.runtimeStore.dropReference(instance.id);
      }
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }
    });
  }

  modify(_positional: never[], named: Args<T>['named']) {
    let {
      query,
      realms,
      isLive,
      doWhileRefreshing,
      seed,
      owner,
      storeService,
    } = named;

    setOwner(this, owner); // works around problem where lifetime parent is used as owner when they should be allowed to differ
    this.#storeServiceOverride = storeService;

    if (query === undefined) {
      return;
    }

    this.#log.info(
      `modify: query present; isLive=${isLive}; realms=${realms?.join(',') ?? '(default)'}`,
    );
    this.#isLive = isLive;
    this.#doWhileRefreshing = doWhileRefreshing;
    this.#dependencyTracking = named.dependencyTracking;
    this.realmsToSearch =
      realms === undefined || realms.length === 0
        ? this.realmServer.availableRealmURLs
        : realms;
    this.#log.info(
      `modify: prepared realms for subscription=${this.realmsToSearch.join(',')}`,
    );
    if (seed && !this.#seedApplied) {
      this.trackStoreLoad(this.applySeed.perform(seed), 'seed');
      this.#seedApplied = true;
      let hasQueryErrors = seed.queryErrors && seed.queryErrors.length > 0;
      if (seed.searchURL && !hasQueryErrors) {
        let { query: seedQuery } = parseSearchURL(seed.searchURL);
        this.#previousQueryString = buildQueryParamValue(
          normalizeQueryForSignature(seedQuery),
        );
      }
      this.#previousQuery = query;
      if (seed.realms) {
        this.#previousRealms = seed.realms;
      }
      this.#log.info(
        `apply seed for search resource (one-time); count=${seed.cards.length}; searchURL=${seed.searchURL}`,
      );
    }

    if (
      isLive &&
      (this.subscriptions.length === 0 ||
        !isEqual(realms, this.#previousRealms))
    ) {
      this.#log.info(
        `subscribing to realms for search resource; realms=${this.realmsToSearch.join(',')}`,
      );
      // need to unsubscribe the old query before subscribing the new query
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }
      this.subscriptions = this.realmsToSearch.map((realm) => {
        this.#log.info(`search-resource calling subscribeToRealm for ${realm}`);
        return {
          url: `${realm}_message`,
          unsubscribe: subscribeToRealm(realm, (event: RealmEventContent) => {
            this.#log.info(
              `search-resource received realm event on ${realm}: ${JSON.stringify(event)}`,
            );
            if (this.#previousQuery === undefined) {
              return;
            }
            // we are only interested in incremental index events
            if (
              event.eventName !== 'index' ||
              ('indexType' in event && event.indexType !== 'incremental')
            ) {
              return;
            }
            this.trackStoreLoad(
              this.search.perform(this.#previousQuery),
              'live-refresh',
            );
          }),
        };
      });
    }

    let queryString = buildQueryParamValue(normalizeQueryForSignature(query));
    if (
      isEqual(queryString, this.#previousQueryString) &&
      isEqual(realms, this.#previousRealms)
    ) {
      // we want to only run the search when there is a deep equality
      // difference, not a strict equality difference
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
    this.trackStoreLoad(this.search.perform(query), 'search');
  }
  get isLoading() {
    return this.search.isRunning;
  }
  get isLive() {
    return this.#isLive;
  }
  get instances() {
    return this._instances;
  }
  @cached
  get instancesByRealm() {
    return this.realmsToSearch
      .map((realm) => {
        let cards = this.instances.filter((card) => card.id.startsWith(realm));
        return { realm, cards };
      })
      .filter((r) => r.cards.length > 0);
  }
  @cached
  get meta() {
    return this._meta;
  }
  @cached
  get errors() {
    return this._errors;
  }

  private async updateInstances(
    newInstances: T[],
    dependencyTrackingContext?: RuntimeDependencyTrackingContext,
  ) {
    let oldReferences = this._instances.map((i) => i.id);
    // Please note 3 things there:
    // 1. we are mutating this._instances, not replacing it
    // 2. the items in this array come from an identity map, so we are never
    //    recreating an instance that already exists.
    // 3. The ordering of the results is important, we need to retain that.
    //
    //  As such, removing all the items in-place in our tracked
    //  this._instances array, and then re-adding the new results back into
    //  the array in the correct order synchronously is a stable operation.
    //  glimmer understands the delta and will only rerender the components
    //  tied to the instances that are added (or removed) from the array
    this._instances.splice(0, this._instances.length, ...newInstances);
    if (this.#doWhileRefreshing) {
      this.#doWhileRefreshing();
    }
    let newReferences = this._instances.map((i) => i.id);
    for (let card of this._instances) {
      let isFileMeta = isFileDefInstance(card);
      let maybeInstance = card?.id
        ? isFileMeta
          ? this.runtimeStore.peek(card.id, { type: 'file-meta' })
          : this.runtimeStore.peek(card.id)
        : undefined;
      if (
        !maybeInstance &&
        (card as unknown as { type?: string })?.type !== 'not-loaded' // TODO: under what circumstances could this happen?
      ) {
        if (isFileMeta) {
          await this.runtimeStore.get(card.id, {
            type: 'file-meta',
            dependencyTrackingContext,
          });
        } else {
          await this.runtimeStore.add(
            card as CardDef,
            {
              doNotPersist: true,
              dependencyTrackingContext,
            }, // search results always have id's
          );
        }
      }
    }
    let referencesToDrop = difference(oldReferences, newReferences);
    for (let id of referencesToDrop) {
      this.runtimeStore.dropReference(id);
    }
    let referencesToAdd = difference(newReferences, oldReferences);
    for (let id of referencesToAdd) {
      this.runtimeStore.addReference(id);
    }
    return this.runtimeStore.flush();
  }

  private dependencyTrackingContext(
    source: string,
  ): RuntimeDependencyTrackingContext | undefined {
    return runtimeDependencyContextWithSource(this.#dependencyTracking, source);
  }

  private applySeed = task(
    async (seed: NonNullable<Args<T>['named']['seed']>) => {
      let dependencyTrackingContext = this.dependencyTrackingContext(
        'search-resource:applySeed',
      );
      await Promise.resolve();
      this._meta = seed.meta ?? { page: { total: seed.cards.length } };
      this._errors = seed.errors;
      await this.updateInstances(seed.cards, dependencyTrackingContext);
    },
  );

  private search = restartableTask(async (query: Query) => {
    this.#log.info(
      `search task start; realms=${this.realmsToSearch.join(',')}; query=${JSON.stringify(query)}`,
    );
    // we cannot use the `waitForPromise` test waiter helper as that will cast
    // the Task instance to a promise which makes it uncancellable. When this is
    // uncancellable it results in a flaky test.
    let token = waiter.beginAsync();
    try {
      let dependencyTrackingContext = this.dependencyTrackingContext(
        'search-resource:search',
      );
      let { instances, meta } = await this.runtimeStore.search<T>(
        query,
        this.realmsToSearch,
        {
          includeMeta: true,
          dependencyTrackingContext,
        },
      );
      this.#log.info(
        `search task complete; total instances=${instances.length}; refs=${instances
          .map((r) => r.id)
          .join(',')}`,
      );
      this._meta = meta;
      this._errors = undefined;
      await this.updateInstances(instances, dependencyTrackingContext);
    } finally {
      waiter.endAsync(token);
    }
  });
}
// WARNING! please don't import this directly into your component's module.
// Rather please instead use:
// ```
//   import { consume } from 'ember-provide-consume-context';
//   import { type getCards, GetCardsContextName } from '@cardstack/runtime-common';
//    ...
//   @consume(GetCardsContextName) private declare getCards: getCards;
// ```
// If you need to use `getSearch()`/`getCards()` in something that is not a Component, then
// let's talk.
export function getSearch<T extends CardDef | FileDef = CardDef>(
  parent: object,
  owner: Owner,
  getQuery: () => Query | undefined,
  getRealms?: () => string[] | undefined,
  opts?: {
    isLive?: boolean;
    storeService?: StoreService;
    doWhileRefreshing?: (() => void) | undefined;
    seed?:
      | {
          cards: T[];
          searchURL?: string;
          meta?: QueryResultsMeta;
          errors?: ErrorEntry[];
          queryErrors?: Array<{
            realm: string;
            type: string;
            message: string;
            status?: number;
          }>;
        }
      | undefined;
    dependencyTracking?: RuntimeDependencyTrackingContext | undefined;
  },
) {
  let resource = SearchResource.from(parent, () => ({
    named: {
      query: getQuery(),
      realms: getRealms ? getRealms() : undefined,
      isLive: opts?.isLive != null ? opts.isLive : false,
      storeService: opts?.storeService,
      // TODO refactor this out
      doWhileRefreshing: opts?.doWhileRefreshing,
      seed: opts?.seed,
      dependencyTracking: opts?.dependencyTracking,
      owner,
    },
  }));
  return resource;
}
