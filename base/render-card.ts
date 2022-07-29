import { Resource, useResource } from "ember-resources";
import { restartableTask } from "ember-concurrency";
import { tracked } from "@glimmer/tracking";
import { ComponentLike } from "@glint/template";
import { Format, Card, prepareToRender } from "./card-api";

interface Args {
  // note that we are using a Card instance as the arg and not card data so that
  // any changes to the format wont result in lost card data during a rerender
  // (since a card can be edited after it's rendered)
  named: { card: Card | undefined; format: Format };
}

export class RenderedCard extends Resource<Args> {
  @tracked component: ComponentLike<{ Args: {}; Blocks: {} }> | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    let { card, format } = args.named;
    if (card) {
      (this.load as any).perform(card, format); // ember-concurrency-ts is not cooperating
    }
  }

  @restartableTask private *load(card: Card, format: Format) {
    let { component }: { component: ComponentLike<{ Args: {}; Blocks: {} }> } =
      yield prepareToRender(card, format);
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
