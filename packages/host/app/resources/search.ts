import { Resource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { baseRealm, type RealmInfo } from '@cardstack/runtime-common';
import { service } from '@ember/service';
import flatMap from 'lodash/flatMap';
import ENV from '@cardstack/host/config/environment';
import type CardService from '../services/card-service';
import type { Query } from '@cardstack/runtime-common/query';
import type { Card } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    query: Query;
    realms?: string[];
  };
}

// This is temporary until we have a better way of discovering the realms that
// are available for a user to search from
const { otherRealmURLs } = ENV;

export class Search extends Resource<Args> {
  @tracked instances: Card[] = [];
  @tracked instancesWithRealmInfo: { realmInfo: RealmInfo; card: Card }[] = [];
  @service declare cardService: CardService;
  ready: Promise<void> | undefined;

  modify(_positional: never[], named: Args['named']) {
    let { query, realms } = named;
    this.ready = this.search.perform(query, realms);
  }

  private search = restartableTask(async (query: Query, realms?: string[]) => {
    // until we have realm index rollup, search all the realms as separate
    // queries that we merge together
    this.instances = flatMap(
      await Promise.all(
        // use a Set since the default URL may actually be the base realm
        [
          ...new Set(
            realms ?? [
              this.cardService.defaultURL.href,
              baseRealm.url,
              ...otherRealmURLs,
            ],
          ),
        ].map(
          async (realm) => await this.cardService.search(query, new URL(realm)),
        ),
      ),
    );

    this.instancesWithRealmInfo = await Promise.all(
      this.instances.map(async (card) => {
        let realmInfo = await this.cardService.getRealmInfo(card);
        if (!realmInfo) {
          throw new Error(`Could not find realm info for ${card.id}`);
        }
        return { realmInfo, card };
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
