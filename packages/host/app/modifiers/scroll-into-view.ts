import Modifier, { PositionalArgs } from 'ember-modifier';

interface ScrollIntoViewModifierArgs {
  Positional: [boolean];
}

interface ScrollIntoViewModifierSignature {
  Element: Element;
  Args: ScrollIntoViewModifierArgs;
}

export default class ScrollIntoViewModifier extends Modifier<ScrollIntoViewModifierSignature> {
  element!: Element;
  #didSetup = false;

  modify(
    element: Element,
    [shouldScrollIntoView]: PositionalArgs<ScrollIntoViewModifierSignature>,
  ): void {
    this.element = element;

    if (!this.#didSetup) {
      this.#didSetup = true;

      if (shouldScrollIntoView) {
        this.element.scrollIntoView({ block: 'center' });
      }
    }
  }
}
