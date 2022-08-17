import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import {
  ExportedCardRef,
  ResourceObjectWithId,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { stringify } from 'qs';
import { service } from '@ember/service';
import LocalRealm from '../services/local-realm';

interface Args {
  named: {
    cardRef: {
      module: string;
      name: string;
    };
  };
}

export class CatalogEntry extends Resource<Args> {
  @tracked entries: ResourceObjectWithId[] = [];
  @service declare localRealm: LocalRealm;
  @tracked localRealmURL: URL;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    if (!this.localRealm.isAvailable) {
      throw new Error('Local realm is not available');
    }
    this.localRealmURL = this.localRealm.url;
    let { cardRef } = args.named;
    taskFor(this.getCatalogEntry).perform(cardRef);
  }

  @restartableTask private async getCatalogEntry(
    cardRef: Args['named']['cardRef']
  ) {
    let response = await Loader.fetch(
      `${this.localRealmURL.href}_search?${stringify({
        filter: {
          on: {
            module: `https://cardstack.com/base/catalog-entry`,
            name: 'CatalogEntry',
          },
          eq: {
            ref: {
              module: cardRef.module,
              name: cardRef.name,
            },
          },
        },
      })}`,
      {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Could not load catalog entry for card ref ${cardRef.module}/${
          cardRef.name
        }: ${response.status} - ${await response.text()}`
      );
    }
    let json = await response.json();
    this.entries = (json.data as ResourceObjectWithId[]) ?? [];
  }
}

export function getCatalogEntry(
  parent: object,
  cardRef: () => ExportedCardRef
) {
  return useResource(parent, CatalogEntry, () => ({
    named: { cardRef: cardRef() },
  }));
}
