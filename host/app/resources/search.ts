import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import {
  CardResource,
  baseRealm,
  isCardCollectionDocument,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { service } from '@ember/service';
import LocalRealm from '../services/local-realm';
import { stringify } from 'qs';
import flatMap from 'lodash/flatMap';
import type { Query } from '@cardstack/runtime-common/query';

interface Args {
  named: {
    query: Query;
    loader: Loader;
  };
}

export class Search extends Resource<Args> {
  @tracked instances: CardResource[] = [];
  @service declare localRealm: LocalRealm;
  @tracked localRealmURL: URL;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    if (!this.localRealm.isAvailable) {
      throw new Error('Local realm is not available');
    }
    this.localRealmURL = this.localRealm.url;
    let { query, loader } = args.named;
    taskFor(this.search).perform(query, loader);
  }

  @restartableTask private async search(query: Query, loader: Loader) {
    // until we have realm index rollup, search all the realms as separate
    // queries that we merge together
    this.instances = flatMap(
      await Promise.all(
        [this.localRealmURL.href, loader.resolve(baseRealm.url)].map(
          async (realm) => {
            let response = await loader.fetch(
              `${realm}_search?${stringify(query)}`,
              {
                headers: { Accept: 'application/vnd.api+json' },
              }
            );
            if (!response.ok) {
              throw new Error(
                `Could not load card for query ${stringify(query)}: ${
                  response.status
                } - ${await response.text()}`
              );
            }
            let json = await response.json();
            if (!isCardCollectionDocument(json)) {
              throw new Error(
                `The realm search response was not a card collection document: ${JSON.stringify(
                  json,
                  null,
                  2
                )}`
              );
            }
            return json.data;
          }
        )
      )
    );
  }

  get isLoading() {
    return taskFor(this.search).isRunning;
  }
}

export function getSearchResults(
  parent: object,
  query: () => Query,
  loader: () => Loader
) {
  return useResource(parent, Search, () => ({
    named: { query: query(), loader: loader() },
  }));
}
