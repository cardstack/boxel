import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { Format, prepareToRender, Card } from '../lib/card-api';
import { tracked } from '@glimmer/tracking';
import { ComponentLike } from '@glint/template';

interface Args {
  named: { card: Card; format: Format };
}

export class RenderedCard extends Resource<Args> {
  @tracked component: ComponentLike<{ Args: {}; Blocks: {} }> | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    let { card, format } = args.named;
    taskFor(this.load).perform(card, format);
  }

  @restartableTask private async load(card: Card, format: Format) {
    let { component } = await prepareToRender(card, format);
    this.component = component;
  }
}

export function renderCard(
  parent: object,
  card: () => Card,
  format: () => Format
) {
  return useResource(parent, RenderedCard, () => ({
    named: { card: card(), format: format() },
  }));
}
