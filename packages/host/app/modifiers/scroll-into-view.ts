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
  #scrollableContainer: Element | undefined;
  #lastRunScrolled = false;

  modify(
    element: Element,
    [shouldScrollIntoView]: PositionalArgs<ScrollIntoViewModifierSignature>,
    { container, key }: NamedArgs<ScrollIntoViewModifierSignature>,
  ): void {
    this.element = element;

    if (!this.#scrollableContainer) {
      this.#scrollableContainer = this.findScrollableContainer();
    }

    if (
      shouldScrollIntoView &&
      container &&
      key &&
      !this.scrollPositionService.keyHasScrollPosition(container, key) &&
      !this.#lastRunScrolled
    ) {
      this.scrollIfNotVisible();
      this.#lastRunScrolled = true;
    } else {
      this.#lastRunScrolled = false;
    }
  }

  // Adapted from https://gist.github.com/wojtekmaj/fe811af47fad12a7265b6f7df1017c83
  private findScrollableContainer() {
    let element = this.element;

    if (!element) {
      return undefined;
    }

    let parent = element.parentElement;

    while (parent) {
      const { overflow } = window.getComputedStyle(parent);
      if (overflow.split(' ').every((o) => o === 'auto' || o === 'scroll')) {
        return parent;
      }
      parent = parent.parentElement;
    }

    return document.documentElement;
  }

  // Adapted from https://phuoc.ng/collection/html-dom/check-if-an-element-is-visible-in-a-scrollable-container/
  private scrollIfNotVisible() {
    let element = this.element;
    let container = this.#scrollableContainer;

    if (!container) {
      return;
    }

    let { bottom, height, top } = element.getBoundingClientRect();
    let containerRect = container.getBoundingClientRect();

    if (
      !(top <= containerRect.top
        ? containerRect.top - top <= height
        : bottom - containerRect.bottom <= height)
    ) {
      this.element.scrollIntoView({ block: 'center' });
    }
  }
}
