import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { CardInspector, CardDefinition } from 'runtime-spike/lib/schema-util';

interface Args {
  named: { src: string; inspector: CardInspector; currentPath: string };
}

export class CardDefinitionsResource extends Resource<Args> {
  // TODO move tracking down to the individual fields
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
    // I wonder if we could figure out a better answer here for making the
    // current path available to the inspector so that it can derive relative
    // module imports
    inspector.currentPath = currentPath;
    this.cards = (await inspector.inspectCards(src)).cards;
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
