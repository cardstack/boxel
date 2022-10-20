import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { ComponentLike } from '@glint/template';
import type { Format, Card } from 'https://cardstack.com/base/card-api';
import { taskFor } from 'ember-concurrency-ts';
import { service } from '@ember/service';
import CardService from '../services/card-service';

interface Args {
  // note that we are using a Card instance as the arg and not card data so that
  // any changes to the format wont result in lost card data during a rerender
  // (since a card can be edited after it's rendered)
  named: { card: Card | undefined; format: Format };
}

export class RenderedCard extends Resource<Args> {
  @service declare cardService: CardService;
  @tracked component: ComponentLike<{ Args: {}; Blocks: {} }> | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    let { card, format } = args.named;
    if (card) {
      taskFor(this.load).perform(card, format);
    }
  }

  @restartableTask private async load(card: Card, format: Format) {
    this.component = await this.cardService.loadComponent(card, format);
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
