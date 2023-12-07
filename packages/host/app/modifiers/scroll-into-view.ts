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
  #lastRunScrolled = false;

  async modify(
    element: Element,
    [shouldScrollIntoView]: PositionalArgs<ScrollIntoViewModifierSignature>,
    { container, key }: NamedArgs<ScrollIntoViewModifierSignature>,
  ): Promise<void> {
    this.element = element;

    if (
      shouldScrollIntoView &&
      container &&
      key &&
      !this.scrollPositionService.keyHasScrollPosition(container, key) &&
      !this.#lastRunScrolled
    ) {
      await this.scrollIfNotVisible();
      this.#lastRunScrolled = true;
    } else {
      this.#lastRunScrolled = false;
    }
  }

  private async scrollIfNotVisible() {
    let element = this.element;

    return new Promise((resolve) => {
      let intersectionObserver = new IntersectionObserver(function (entries) {
        intersectionObserver.unobserve(element);

        if (!entries[0].isIntersecting) {
          element.scrollIntoView({ block: 'center' });
        }

        resolve(void 0);
      });

      intersectionObserver.observe(element);
    });
  }
}
