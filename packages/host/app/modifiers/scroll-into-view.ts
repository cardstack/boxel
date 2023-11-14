import Modifier, { type PositionalArgs } from 'ember-modifier';

interface ScrollIntoViewModifierArgs {
  Positional: [boolean];
}

interface ScrollIntoViewModifierSignature {
  Element: Element;
  Args: ScrollIntoViewModifierArgs;
}

export default class ScrollIntoViewModifier extends Modifier<ScrollIntoViewModifierSignature> {
  #didSetup = false;

  modify(
    element: Element,
    [shouldScrollIntoView]: PositionalArgs<ScrollIntoViewModifierSignature>,
  ): void {
    if (!this.#didSetup) {
      this.#didSetup = true;

      if (shouldScrollIntoView) {
        element.scrollIntoView({ block: 'center' });
      }
    }
  }
}
