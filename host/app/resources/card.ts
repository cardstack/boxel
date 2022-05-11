import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { Format, prepareToRender, Card } from '../lib/card-api';
import { tracked } from '@glimmer/tracking';

interface Args {
  named: { card: typeof Card; data: Record<string, any> };
}

export class CardResource extends Resource<Args> {
  @tracked component: any; // using "any" to work around ComponentLike<{ Args: never; Block: never }> not linting in glint template
  card: Card | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    let { card: cardClass } = args.named;
    if (cardClass) {
      this.card = cardClass.fromSerialized(cardClass.data ?? {});
      taskFor(this.load).perform();
    }
  }

  @restartableTask private async load(format: Format = 'isolated') {
    if (this.card) {
      let { component } = await prepareToRender(this.card, format);
      this.component = component;
    }
  }

  @restartableTask private async _setFormat(format: Format) {
    await taskFor(this.load).perform(format);
  }

  setFormat(format: Format) {
    taskFor(this._setFormat).perform(format);
  }
}

export function card(parent: object, card: () => typeof Card | undefined) {
  return useResource(parent, CardResource, () => ({
    named: { card: card() },
  }));
}
