import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { CardInspector, CardDefinition } from 'runtime-spike/lib/schema-util';

interface Args {
  named: { src: string; inspector: CardInspector };
}

export class CardDefinitionsResource extends Resource<Args> {
  // TODO move tracking down to the individual fields
  @tracked cards: CardDefinition[] | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    let { src, inspector } = args.named;
    taskFor(this.inspect).perform(src, inspector);
  }

  @restartableTask private async inspect(
    src: string,
    inspector: CardInspector
  ) {
    this.cards = (await inspector.inspectCards(src)).cards;
  }
}

export function cardDefinitions(
  parent: object,
  src: () => string,
  inspector: () => CardInspector
) {
  return useResource(parent, CardDefinitionsResource, () => ({
    named: { src: src(), inspector: inspector() },
  }));
}
