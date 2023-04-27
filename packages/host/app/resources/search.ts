import { Resource } from 'ember-resources/core';
import { restartableTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { baseRealm } from '@cardstack/runtime-common';
import { service } from '@ember/service';
import flatMap from 'lodash/flatMap';
import type CardService from '../services/card-service';
import type { Query } from '@cardstack/runtime-common/query';
import type { CardBase } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    query: Query;
  };
}

export class Search extends Resource<Args> {
  @tracked instances: CardBase[] = [];
  @service declare cardService: CardService;

  modify(_positional: never[], named: Args['named']) {
    let { query } = named;
    this.search.perform(query);
  }

  get isSearching() {
    return this.search.isRunning;
  }

  private search = restartableTask(async (query: Query) => {
    // until we have realm index rollup, search all the realms as separate
    // queries that we merge together
    this.instances = flatMap(
      await Promise.all(
        // use a Set since the default URL may actually be the base realm
        [...new Set([this.cardService.defaultURL.href, baseRealm.url])].map(
          async (realm) => await this.cardService.search(query, new URL(realm))
        )
      )
    );
  });

  get isLoading() {
    return this.search.isRunning;
  }
}

export function getSearchResults(parent: object, query: () => Query) {
  return Search.from(parent, () => ({
    named: {
      query: query(),
    },
  })) as Search;
}
