import { inject as service } from '@ember/service';

import Modifier, { NamedArgs, PositionalArgs } from 'ember-modifier';

import ScrollPositionService from '@cardstack/host/services/scroll-position-service';

interface ScrollIntoViewModifierArgs {
  Positional: [boolean];
  Named: { container?: string; key?: string };
}

interface ScrollIntoViewModifierSignature {
  Element: Element;
  Args: ScrollIntoViewModifierArgs;
}

export default class ScrollIntoViewModifier extends Modifier<ScrollIntoViewModifierSignature> {
  @service declare scrollPositionService: ScrollPositionService;

  element!: Element;
  #didSetup = false;

  modify(
    element: Element,
    [shouldScrollIntoView]: PositionalArgs<ScrollIntoViewModifierSignature>,
    { container, key }: NamedArgs<ScrollIntoViewModifierSignature>,
  ): void {
    this.element = element;

    if (!this.#didSetup) {
      this.#didSetup = true;

      if (shouldScrollIntoView) {
        if (
          container &&
          key &&
          !this.scrollPositionService.keyHasScrollPosition(container, key)
        ) {
          this.element.scrollIntoView({ block: 'center' });
        }
      }
    }
  }
}
