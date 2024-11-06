import { service } from '@ember/service';
import { waitForPromise } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';
import flatMap from 'lodash/flatMap';

import { type RealmCards } from '@cardstack/runtime-common';

import type { Query } from '@cardstack/runtime-common/query';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type CardService from '../services/card-service';
import type RealmServerService from '../services/realm-server';

interface Args {
  named: {
    query: Query;
    realms?: string[];
    doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>;
  };
}

export class Search extends Resource<Args> {
  @service private declare cardService: CardService;
  @service private declare realmServer: RealmServerService;
  @tracked private _instances: CardDef[] = [];
  @tracked private _instancesByRealm: RealmCards[] = [];
  @tracked private staleInstances: CardDef[] = [];
  @tracked private staleInstancesByRealm: RealmCards[] = [];
  @tracked private realmsToSearch: string[] = [];
  loaded: Promise<void> | undefined;

  modify(_positional: never[], named: Args['named']) {
    let { query, realms } = named;
    this.realmsToSearch = realms ?? this.realmServer.availableRealmURLs;

    this.loaded = this.search.perform(query);
    waitForPromise(this.loaded);
  }

  get instances() {
    return this.isLoading ? this.staleInstances : this._instances;
  }

  get instancesByRealm() {
    return this.isLoading ? this.staleInstancesByRealm : this._instancesByRealm;
  }

  private search = restartableTask(async (query: Query) => {
    this._instances = flatMap(
      await Promise.all(
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
  query: Query,
  realms?: string[],
) {
  return Search.from(parent, () => ({
    named: {
      query,
      realms: realms ?? undefined,
    },
  })) as Search;
}
