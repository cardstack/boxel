import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { CardResource } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { service } from '@ember/service';
import LocalRealm from '../services/local-realm';
import { stringify } from 'qs';
import type { Query } from '@cardstack/runtime-common/query';

interface Args {
  named: {
    query: Query;
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
    let { query } = args.named;
    taskFor(this.search).perform(query);
  }

  @restartableTask private async search(query: Query) {
    let response = await Loader.fetch(
      `${this.localRealmURL.href}_search?${stringify(query)}`,
      { headers: { Accept: 'application/vnd.api+json' } }
    );
    if (!response.ok) {
      throw new Error(
        `Could not load card for query ${stringify(query)}: ${
          response.status
        } - ${await response.text()}`
      );
    }
    let json = await response.json();
    this.instances = (json.data as CardResource[]) ?? [];
  }
}

export function getSearchResults(parent: object, query: () => Query) {
  return useResource(parent, Search, () => ({
    named: { query: query() },
  }));
}
