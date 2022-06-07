import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { CardInspector, CardDefinition } from 'runtime-spike/lib/schema-util';

interface Args {
  named: { src: string; inspector: CardInspector; currentPath: string };
}

export class CardDefinitionsResource extends Resource<Args> {
  // TODO probably want to move tracking down to the individual fields
  @tracked cards: CardDefinition[] | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    let { src, inspector, currentPath } = args.named;
    taskFor(this.inspect).perform(src, inspector, currentPath);
  }

  @restartableTask private async inspect(
    src: string,
    inspector: CardInspector,
    currentPath: string
  ) {
    this.cards = (await inspector.inspectCards(src, currentPath)).cards;
  }
}

export function cardDefinitions(
  parent: object,
  src: () => string,
  inspector: () => CardInspector,
  currentPath: () => string
) {
  return useResource(parent, CardDefinitionsResource, () => ({
    named: { src: src(), inspector: inspector(), currentPath: currentPath() },
  }));
}
