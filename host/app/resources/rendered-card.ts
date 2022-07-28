import { Resource, useResource } from 'ember-resources';
import { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { ComponentLike } from '@glint/template';
import CardAPI from '../services/card-api';
import type { Format, Card } from 'https://cardstack.com/base/card-api';

interface Args {
  named: { card: Card | undefined; format: Format };
}

export class RenderedCard extends Resource<Args> {
  @tracked component: ComponentLike<{ Args: {}; Blocks: {} }> | undefined;
  @service declare cardAPI: CardAPI;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    let { card, format } = args.named;
    if (card) {
      taskFor(this.load).perform(card, format);
    }
  }

  @restartableTask private async load(card: Card, format: Format) {
    await this.cardAPI.loaded;
    let { component } = await this.cardAPI.api.prepareToRender(card, format);
    this.component = component;
  }
}

export function render(
  parent: object,
  card: () => Card | undefined,
  format: () => Format
) {
  return useResource(parent, RenderedCard, () => ({
    named: { card: card(), format: format() },
  }));
}
