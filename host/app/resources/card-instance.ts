import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { Loader } from '@cardstack/runtime-common/loader';
import type { Card } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    CardClass: typeof Card | undefined;
    serializedData: any;
  };
}

export class CardInstance extends Resource<Args> {
  @tracked instance: Card | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);

    let { CardClass, serializedData } = args.named;
    if (CardClass !== undefined) {
      taskFor(this.createCard).perform(CardClass, serializedData);
    }
  }

  @restartableTask private async createCard(CardClass: typeof Card, data: any) {
    let api = await Loader.import<
      typeof import('https://cardstack.com/base/card-api')
    >('https://cardstack.com/base/card-api');
    let instance = await api.createFromSerialized(CardClass, data);
    this.instance = instance;
  }
}

export function cardInstance(
  parent: object,
  CardClass: () => typeof Card | undefined,
  serializedData: () => any
) {
  return useResource(parent, CardInstance, () => ({
    named: { CardClass: CardClass(), serializedData: serializedData() },
  }));
}
