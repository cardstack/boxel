import { registerDestructor } from '@ember/destroyable';

import { service } from '@ember/service';
import { waitForPromise } from '@ember/test-waiters';
import { tracked, cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';
import flatMap from 'lodash/flatMap';

import { stringify } from 'qs';
import { TrackedMap } from 'tracked-built-ins';

import {
  subscribeToRealm,
  isCardCollectionDocument,
  SingleCardDocument,
} from '@cardstack/runtime-common';

import type { Query } from '@cardstack/runtime-common/query';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { type CardResource, getCard, asURL } from './card-resource';

import type CardService from '../services/card-service';
import type RealmServerService from '../services/realm-server';

interface Args {
  named: {
    query: Query;
    realms?: string[];
    isLive?: true;
    doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>;
  };
}

export class Search extends Resource<Args> {
  @service private declare cardService: CardService;
  @service private declare realmServer: RealmServerService;
  @tracked private realmsToSearch: string[] = [];
  loaded: Promise<void> | undefined;
  private subscriptions: { url: string; unsubscribe: () => void }[] = [];
  private cardResources = new Map<string, CardResource>();
  private seenCardResource = new TrackedMap<string, CardResource>();
  private currentResults = new TrackedMap<string, CardResource>();

  modify(_positional: never[], named: Args['named']) {
    let { query, realms, isLive, doWhileRefreshing } = named;
    this.realmsToSearch = realms ?? this.realmServer.availableRealmURLs;

    this.loaded = this.search.perform(query);
    waitForPromise(this.loaded);

    if (isLive) {
      this.subscriptions = this.realmsToSearch.map((realm) => ({
        url: `${realm}_message`,
        unsubscribe: subscribeToRealm(
          `${realm}_message`,
          ({ type, data }: { type: string; data: string }) => {
            let eventData = JSON.parse(data);
            // we are only interested in incremental index events
            if (type !== 'index' || eventData.type !== 'incremental') {
              return;
            }
            this.search.perform(query);
            if (doWhileRefreshing) {
              this.doWhileRefreshing.perform(doWhileRefreshing);
            }
          },
        ),
      }));

      registerDestructor(this, () => {
        for (let subscription of this.subscriptions) {
          subscription.unsubscribe();
        }
      });
    }
  }

  @cached
  get instances() {
    return [...this.currentResults.values()].map((r) => r.card) as CardDef[]; // empty results are filtered out already
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

  // By default, this does a tracked read from seenCards so that your
  // answer can be invalidated if a new card is discovered. Internally, we also
  // use it untracked to implement the read-through cache.
  private seenCard(url: string, tracked = true): CardResource | undefined {
    let resource = this.cardResources.get(url);
    if (resource) {
      return resource;
    }
    if (tracked) {
      this.seenCardResource.has(url);
    }
    return undefined;
  }

  private getOrCreateCardResource(
    urlOrDoc: string | SingleCardDocument,
  ): CardResource {
    let url = asURL(urlOrDoc);
    // this should be the only place we do the untracked read. It needs to be
    // untracked so our `this.cardResources.set` below will not be an assertion.
    let resource = this.seenCard(url, false);
    if (!resource) {
      resource = getCard(this, () => urlOrDoc, {
        isLive: () => true,
      });
      this.cardResources.set(url, resource);
      // only after the set has happened can we safely do the tracked read to
      // establish our dependency.
      this.seenCardResource.set(url, resource);
    }
    return resource;
  }

  private search = restartableTask(async (query: Query) => {
    let results = flatMap(
      await Promise.all(
        this.realmsToSearch.map(async (realm) => {
          let json = await this.cardService.fetchJSON(
            `${realm}_search?${stringify(query)}`,
          );
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
                  collectionDoc.data.map(async (doc) =>
                    this.getOrCreateCardResource({ data: doc }),
                  ),
                )
              ).filter(
                (p) => p.status === 'fulfilled',
              ) as PromiseFulfilledResult<CardResource>[]
            ).map((p) => p.value)
          );
        }),
      ),
    );

    await Promise.all(results.map((r) => r.loaded));
    let resultsWithoutErrors = results.filter((r) => r.card && r.url);
    let resultMap = new Map<string, CardResource>();
    for (let resource of resultsWithoutErrors) {
      resultMap.set(resource.url!, resource);
    }
    for (let url of this.currentResults.keys()) {
      if (!resultMap.has(url)) {
        this.currentResults.delete(url);
      }
    }
    for (let [url, resource] of resultMap) {
      if (!this.currentResults.has(url)) {
        this.currentResults.set(url, resource);
      }
    }
  });

  get isLoading() {
    return this.search.isRunning;
  }
}

export function getSearchResults(
  parent: object,
  query: Query,
  realms?: string[],
  opts?: {
    isLive?: true;
    // it is probably desirable that dynamic context action `doWithStableScroll()`
    // is used here. For example:
    //
    //   async (ready: Promise<void> | undefined) => {
    //     if (this.args.context?.actions) {
    //       this.args.context.actions.doWithStableScroll(
    //         this.args.model as CardDef,
    //         async () => { await ready; }
    //       );
    //     }
    //   }
    doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>;
  },
) {
  return Search.from(parent, () => ({
    named: {
      query,
      realms: realms ?? undefined,
      isLive: opts?.isLive,
      doWhileRefreshing: opts?.doWhileRefreshing,
    },
  })) as Search;
}
