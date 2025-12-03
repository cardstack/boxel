import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { tracked, cached } from '@glimmer/tracking';
import { restartableTask, task } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import difference from 'lodash/difference';
import flatMap from 'lodash/flatMap';
import isEqual from 'lodash/isEqual';
import { TrackedArray } from 'tracked-built-ins';

import type { QueryResultsMeta, ErrorEntry } from '@cardstack/runtime-common';
import {
  subscribeToRealm,
  isCardCollectionDocument,
  isCardInstance,
  logger as runtimeLogger,
  normalizeQueryForSignature,
  buildQueryString,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import type CardService from '../services/card-service';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';
const waiter = buildWaiter('search-resource:search-waiter');
export interface Args {
  named: {
    query: Query | undefined;
    realms: string[] | undefined;
    isLive: boolean;
    isAutoSaved?: boolean;
    storeService?: StoreService;
    doWhileRefreshing?: (() => void) | undefined;
    seed?:
      | {
          cards: CardDef[];
          searchURL?: string;
          meta?: QueryResultsMeta;
          errors?: ErrorEntry[];
        }
      | undefined;
  };
}
export class SearchResource extends Resource<Args> {
  @service declare private cardService: CardService;
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;
  @tracked private realmsToSearch: string[] = [];
  // Resist the urge to expose this property publicly as that may entice
  // consumers of this resource  to use it in a non-reactive manner (pluck off
  // the instances and throw away the resource).
  // @ts-ignore we use this.loaded for test instrumentation.
  private loaded: Promise<void> | undefined;
  private subscriptions: { url: string; unsubscribe: () => void }[] = [];
  private _instances = new TrackedArray<CardDef>();
  @tracked private _meta: QueryResultsMeta = { page: { total: 0 } };
  @tracked private _errors: ErrorEntry[] | undefined;
  #isLive = false;
  #seedApplied = false;
  #doWhileRefreshing: (() => void) | undefined;
  #previousQueryString: string | undefined;
  #previousRealms: string[] | undefined;
  #log = runtimeLogger('search-resource');

  constructor(owner: object) {
    super(owner);
    registerDestructor(this, () => {
      for (let instance of this._instances) {
        this.store.dropReference(instance.id);
      }
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }
    });
  }

  modify(_positional: never[], named: Args['named']) {
    let { query, realms, isLive, doWhileRefreshing, seed } = named;
    if (query === undefined) {
      return;
    }

    this.#log.info(
      `modify: query present; isLive=${isLive}; realms=${realms?.join(',') ?? '(default)'}`,
    );
    this.#isLive = isLive;
    this.#doWhileRefreshing = doWhileRefreshing;
    this.realmsToSearch =
      realms === undefined || realms.length === 0
        ? this.realmServer.availableRealmURLs
        : realms;
    this.#log.info(
      `modify: prepared realms for subscription=${this.realmsToSearch.join(',')}`,
    );
    if (seed && !this.#seedApplied) {
      this.loaded = this.applySeed.perform(seed);
      this.#seedApplied = true;
      this.#previousQueryString = seed.searchURL;
      this.#log.info(
        `apply seed for search resource (one-time); count=${seed.cards.length}; searchURL=${seed.searchURL}`,
      );
    }

    if (isLive && !isEqual(realms, this.#previousRealms)) {
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
            this.#log.info(
              `received realm event for ${realm}: ${event.eventName} / ${'indexType' in event ? event.indexType : 'n/a'}`,
            );
            if (query === undefined) {
              return;
            }
            // we are only interested in incremental index events
            if (
              event.eventName !== 'index' ||
              ('indexType' in event && event.indexType !== 'incremental')
            ) {
              return;
            }
            this.search.perform(query);
          }),
        };
      });
    }

    let queryString = buildQueryString(normalizeQueryForSignature(query));
    if (
      isEqual(queryString, this.#previousQueryString) &&
      isEqual(realms, this.#previousRealms)
    ) {
      // we want to only run the search when there is a deep equality
      // difference, not a strict equality difference
      return;
    }

    this.#previousRealms = realms;
    this.#previousQueryString = queryString;
    this.loaded = this.search.perform(query);
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

  private async updateInstances(newInstances: CardDef[]) {
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
      if (card?.id) {
        this.store.set(card.id, card);
      }
    }
    let referencesToDrop = difference(oldReferences, newReferences);
    for (let id of referencesToDrop) {
      this.store.dropReference(id);
    }
    let referencesToAdd = difference(newReferences, oldReferences);
    for (let id of referencesToAdd) {
      this.store.addReference(id);
    }
    return this.store.flush();
  }

  private applySeed = task(async (seed: NonNullable<Args['named']['seed']>) => {
    await Promise.resolve();
    this._meta = seed.meta ?? { page: { total: seed.cards.length } };
    this._errors = seed.errors;
    await this.updateInstances(seed.cards);
  });

  private search = restartableTask(async (query: Query) => {
    this.#log.info(
      `search task start; realms=${this.realmsToSearch.join(',')}; query=${JSON.stringify(query)}`,
    );
    // we cannot use the `waitForPromise` test waiter helper as that will cast
    // the Task instance to a promise which makes it uncancellable. When this is
    // uncancellable it results in a flaky test.
    let token = waiter.beginAsync();
    try {
      let searchResults = await Promise.all(
        this.realmsToSearch.map(async (realm) => {
          let json = await this.cardService.fetchJSON(`${realm}_search`, {
            method: 'QUERY',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(query),
          });
          if (!isCardCollectionDocument(json)) {
            throw new Error(
              `The realm search response was not a card collection document:
        ${JSON.stringify(json, null, 2)}`,
            );
          }
          let collectionDoc = json;
          for (let data of collectionDoc.data) {
            let maybeInstance = this.store.peek(data.id!);
            if (!maybeInstance) {
              await this.store.add(
                { data },
                { doNotPersist: true, relativeTo: new URL(data.id!) }, // search results always have id's
              );
            }
          }
          let instances = collectionDoc.data
            .map((r) => this.store.peek(r.id!)) // all results will have id's
            .filter((i) => isCardInstance(i)) as CardDef[];
          return {
            instances,
            meta: collectionDoc.meta,
          };
        }),
      );
      let results = flatMap(searchResults, (result) => result.instances);
      this.#log.info(
        `search task complete; total instances=${results.length}; refs=${results
          .map((r) => r.id)
          .join(',')}`,
      );
      // Combine metadata from all realms
      this._meta = searchResults.reduce(
        (acc, result) => {
          if (result.meta?.page?.total !== undefined) {
            acc.page = acc.page || { total: 0 };
            acc.page.total = (acc.page.total || 0) + result.meta.page.total;
          }
          return acc;
        },
        { page: { total: 0 } } as QueryResultsMeta,
      );
      this._errors = undefined;
      await this.updateInstances(results);
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
export function getSearch(
  parent: object,
  getQuery: () => Query | undefined,
  getRealms?: () => string[] | undefined,
  opts?: {
    isLive?: boolean;
    doWhileRefreshing?: (() => void) | undefined;
    seed?:
      | {
          cards: CardDef[];
          searchURL?: string;
          meta?: QueryResultsMeta;
          errors?: ErrorEntry[];
        }
      | undefined;
  },
) {
  return SearchResource.from(parent, () => ({
    named: {
      query: getQuery(),
      realms: getRealms ? getRealms() : undefined,
      isLive: opts?.isLive != null ? opts.isLive : false,
      // TODO refactor this out
      doWhileRefreshing: opts?.doWhileRefreshing,
      seed: opts?.seed,
    },
  }));
}
