import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Loader, type LooseCardResource } from '@cardstack/runtime-common';
import type LocalRealm from '../services/local-realm';
import type { Card } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    resource: LooseCardResource | undefined;
    loader: Loader;
  };
}

export class CardInstance extends Resource<Args> {
  @tracked instance: Card | undefined;
  @service declare localRealm: LocalRealm;

  constructor(owner: unknown, args: Args) {
    super(owner, args);

    let { resource, loader } = args.named;
    if (resource) {
      taskFor(this.createCard).perform(resource, loader);
    }
  }

  @restartableTask private async createCard(
    resource: LooseCardResource,
    loader: Loader
  ) {
    let api = await loader.import<
      typeof import('https://cardstack.com/base/card-api')
    >('https://cardstack.com/base/card-api');
    let instance = await api.createFromSerialized(
      resource,
      this.localRealm.url,
      { loader }
    );
    this.instance = instance;
  }
}

export function cardInstance(
  parent: object,
  resource: () => LooseCardResource | undefined,
  loader: () => Loader
) {
  return useResource(parent, CardInstance, () => ({
    named: { resource: resource(), loader: loader() },
  }));
}
