import { registerDestructor } from '@ember/destroyable';

import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';
import flatMap from 'lodash/flatMap';

import { baseRealm, subscribeToRealm } from '@cardstack/runtime-common';

import type { Query } from '@cardstack/runtime-common/query';

import ENV from '@cardstack/host/config/environment';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { type RealmCards } from '../components/card-catalog/modal';

import type CardService from '../services/card-service';

interface Args {
  named: {
    query: Query;
    realms?: string[];
    isLive?: true;
    doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>;
  };
}

// This is temporary until we have a better way of discovering the realms that
// are available for a user to search from
const { otherRealmURLs } = ENV;

export class Search extends Resource<Args> {
  @service private declare cardService: CardService;
  @tracked private _instances: CardDef[] = [];
  @tracked private _instancesByRealm: RealmCards[] = [];
  @tracked private staleInstances: CardDef[] = [];
  @tracked private staleInstancesByRealm: RealmCards[] = [];
  @tracked private realmsToSearch: string[] = [];
  private ready: Promise<void> | undefined;
  private subscriptions: { url: string; unsubscribe: () => void }[] = [];

  modify(_positional: never[], named: Args['named']) {
    let { query, realms, isLive, doWhileRefreshing } = named;
    this.realmsToSearch = realms ?? [
      ...new Set(
        realms ?? [
          this.cardService.defaultURL.href,
          baseRealm.url,
          ...otherRealmURLs,
        ],
      ),
    ];
    this.ready = this.search.perform(query);

    if (isLive) {
      // TODO this triggers a new search against all realms if any single realm
      // updates. Make this more precise where we only search the updated realm
      // instead of all realms.
      this.subscriptions = this.realmsToSearch.map((realm) => ({
        url: `${realm}_message`,
        unsubscribe: subscribeToRealm(`${realm}_message`, ({ type }) => {
          // we are only interested in index events
          if (type !== 'index') {
            return;
          }
          // we show stale instances during a live refresh while we are
          // waiting for the new instances to arrive--this eliminates the flash
          // while we wait
          this.staleInstances = [...(this.instances ?? [])];
          this.staleInstancesByRealm = [...(this._instancesByRealm ?? [])];

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

  get instances() {
    return this.isLoading ? this.staleInstances : this._instances;
  }

  get instancesByRealm() {
    return this.isLoading ? this.staleInstancesByRealm : this._instancesByRealm;
  }

  private doWhileRefreshing = restartableTask(
    async (
      doWhileRefreshing: (ready: Promise<void> | undefined) => Promise<void>,
    ) => {
      await doWhileRefreshing(this.ready);
    },
  );

  private search = restartableTask(async (query: Query) => {
    this._instances = flatMap(
      await Promise.all(
        // use a Set since the default URL may actually be the base realm
        this.realmsToSearch.map(
          async (realm) => await this.cardService.search(query, new URL(realm)),
        ),
      ),
    );

    let realmsWithCards = this.realmsToSearch
      .map((url) => {
        let cards = this._instances.filter((card) => card.id.startsWith(url));
        return { url, cards };
      })
      .filter((r) => r.cards.length > 0);

    this._instancesByRealm = await Promise.all(
      realmsWithCards.map(async ({ url, cards }) => {
        let realmInfo = await this.cardService.getRealmInfo(cards[0]);
        if (!realmInfo) {
          throw new Error(`Could not find realm info for card ${cards[0].id}`);
        }
        return { url, realmInfo, cards };
      }),
    );
  });

  get isLoading() {
    return this.search.isRunning;
  }
}

export function getSearchResults(
  parent: object,
  query: () => Query,
  realms?: () => string[],
) {
  return Search.from(parent, () => ({
    named: {
      query: query(),
      realms: realms ? realms() : undefined,
    },
  })) as Search;
}

// A new search is triggered whenever the index updates. Consumers of this
// function that render their cards using {{#each}} should make sure to use the
// "key" field: {{#each #this.results.instances key="id" as |instance|}} in
// order to keep the results stable between refreshes.
export function getLiveSearchResults(
  parent: object,
  query: () => Query,
  realms?: () => string[],
  doWhileRefreshing?: () => (ready: Promise<void> | undefined) => Promise<void>,
) {
  return Search.from(parent, () => ({
    named: {
      isLive: true,
      query: query(),
      realms: realms ? realms() : undefined,
      doWhileRefreshing: doWhileRefreshing ? doWhileRefreshing() : undefined,
    },
  })) as Search;
}
