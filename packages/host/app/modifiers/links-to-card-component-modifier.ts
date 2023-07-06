import Modifier from 'ember-modifier';
import { CardBase, CardContext } from 'https://cardstack.com/base/card-api';
import { registerDestructor } from '@ember/destroyable';

interface Signature {
  Args: {
    Positional: [card: CardBase, context: CardContext];
  };
}

export default class LinksToCardComponentModifier extends Modifier<Signature> {
  modify(
    element: HTMLElement,
    [card, context]: Signature['Args']['Positional']
  ) {
    // if (!context.optional) {
    //   // Do not try run modify hook if optional is not used
    //   return;
    // }
    // if (context.optional.fieldType !== 'linksTo') {
    //   return;
    // }

    if (!card) {
      return; // Empty linked card. Don't render the "Open" button because there is nothing to open.
    }

    (context.renderedIn as any)?.registerLinkedCardElement(
      element,
      card,
      context
    );
    registerDestructor(this, () => {
      (context.renderedIn as any)?.unregisterLinkedCardElement(card);
    });
  }
}
