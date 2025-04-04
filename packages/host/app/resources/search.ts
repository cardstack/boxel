import { registerDestructor } from '@ember/destroyable';

import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { tracked, cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';
import flatMap from 'lodash/flatMap';

import { TrackedArray } from 'tracked-built-ins';

import {
  subscribeToRealm,
  isCardCollectionDocument,
} from '@cardstack/runtime-common';

import type { Query } from '@cardstack/runtime-common/query';

import { CardDef } from 'https://cardstack.com/base/card-api';

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
    isAutoSaved: boolean;
    doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>;
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
  private loaded: Promise<void> | undefined;
  private subscriptions: { url: string; unsubscribe: () => void }[] = [];
  private _instances = new TrackedArray<CardDef>();
  #isLive = false;
  #isAutoSaved = false;

  modify(_positional: never[], named: Args['named']) {
    let { query, realms, isLive, doWhileRefreshing, isAutoSaved } = named;
    if (query === undefined) {
      return;
    }
    this.#isLive = isLive;
    this.#isAutoSaved = isAutoSaved;
    this.realmsToSearch =
      realms === undefined || realms.length === 0
        ? this.realmServer.availableRealmURLs
        : realms;

    this.loaded = this.search.perform(query);

    if (isLive) {
      this.subscriptions = this.realmsToSearch.map((realm) => ({
        url: `${realm}_message`,
        unsubscribe: subscribeToRealm(realm, (event: RealmEventContent) => {
          if (query === undefined) {
            return;
          }
          // we are only interested in incremental index events
          if (
            event.eventName !== 'index' ||
            event.indexType !== 'incremental'
          ) {
            return;
          }
          this.search.perform(query);
          if (doWhileRefreshing) {
            this.doWhileRefreshing.perform(doWhileRefreshing);
          }
        }),
      }));

      registerDestructor(this, () => {
        for (let subscription of this.subscriptions) {
          subscription.unsubscribe();
        }
      });
    }
  }

  get isLoading() {
    return this.search.isRunning;
  }

  get isLive() {
    return this.#isLive;
  }

  get isAutoSaved() {
    return this.#isAutoSaved;
  }

  @cached
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

  private doWhileRefreshing = restartableTask(
    async (
      doWhileRefreshing: (ready: Promise<void> | undefined) => Promise<void>,
    ) => {
      await doWhileRefreshing(this.loaded);
    },
  );

  private search = restartableTask(async (query: Query) => {
    // we cannot use the `waitForPromise` test waiter helper as that will cast
    // the Task instance to a promise which makes it uncancellable. When this is
    // uncancellable it results in a flaky test.
    let token = waiter.beginAsync();
    try {
      let results = flatMap(
        await Promise.all(
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
            return (
              // use Promise.allSettled so that if one particular realm is
              // misbehaving it doesn't effect results from other realms
              (
                (
                  await Promise.allSettled(
                    collectionDoc.data.map(async (jsonAPIResource) =>
                      this.store.createSubscriber({
                        resource: this,
                        urlOrDoc: { data: jsonAPIResource },
                        isAutoSaved: this.isAutoSaved,
                        isLive: this.isLive,
                      }),
                    ),
                  )
                ).filter(
                  (p) => p.status === 'fulfilled',
                ) as PromiseFulfilledResult<{ card: CardDef }>[]
              ).map((p) => p.value)
            );
          }),
        ),
      );

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
      this._instances.splice(
        0,
        this._instances.length,
        ...results.map(({ card }) => card),
      );
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
    isAutoSaved?: boolean;
    doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>;
  },
) {
  return SearchResource.from(parent, () => ({
    named: {
      query: getQuery(),
      realms: getRealms ? getRealms() : undefined,
      isLive: opts?.isLive != null ? opts.isLive : true,
      isAutoSaved: opts?.isAutoSaved != null ? opts.isAutoSaved : false,
      // TODO refactor this out
      doWhileRefreshing: opts?.doWhileRefreshing,
    },
  }));
}
