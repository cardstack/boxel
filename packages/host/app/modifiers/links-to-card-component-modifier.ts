import Modifier from 'ember-modifier';
import {
  CardBase,
  CardRenderingContext,
} from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    Positional: [card: CardBase, context: CardRenderingContext];
  };
}

export default class LinksToCardComponentModifier extends Modifier<Signature> {
  modify(
    element: HTMLElement,
    [card, context]: Signature['Args']['Positional']
  ) {
    if (context.optional.fieldType === 'linksTo') {
      (context.renderedIn as any)?.registerLinkedCardElement(
        element,
        card,
        context
      );
    }
  }
}
