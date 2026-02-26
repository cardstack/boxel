import { isDestroying } from '@ember/destroyable';

import Modifier from 'ember-modifier';

import type { NamedArgs } from 'ember-modifier';

interface ScrollAnchorModifierArgs {
  Positional: [];
  Named: { trackSelector?: string; anchorSelector?: string | null };
}

interface ScrollAnchorModifierSignature {
  Element: HTMLElement;
  Args: ScrollAnchorModifierArgs;
}

export default class ScrollAnchor extends Modifier<ScrollAnchorModifierSignature> {
  #element!: HTMLElement;
  #anchorSelector: string | null = null;
  #trackSelector: string | null = null;
  #positionMap = new Map<Element, number>();
  #observer: MutationObserver | null = null;
  #scrollHandler: (() => void) | null = null;
  #isAdjusting = false;

  modify(
    element: HTMLElement,
    // eslint-disable-next-line no-empty-pattern
    []: [],
    { trackSelector, anchorSelector }: NamedArgs<ScrollAnchorModifierSignature>,
  ): () => void {
    this.#element = element;
    this.#anchorSelector = anchorSelector ?? null;
    this.#trackSelector = trackSelector ?? null;

    if (!this.#observer) {
      this.#scrollHandler = this.capturePositions.bind(this);
      element.addEventListener('scroll', this.#scrollHandler, {
        passive: true,
      });

      this.#observer = new MutationObserver(this.handleMutations.bind(this));
      this.#observer.observe(element, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });

      this.capturePositions();
    }

    return () => {
      this.#observer?.disconnect();
      this.#observer = null;
      if (this.#scrollHandler) {
        element.removeEventListener('scroll', this.#scrollHandler);
      }
    };
  }

  private capturePositions(): void {
    if (this.#isAdjusting || !this.#trackSelector) {
      return;
    }
    this.#positionMap.clear();
    let elements = this.#element.querySelectorAll(this.#trackSelector);
    elements.forEach((el) => {
      this.#positionMap.set(el, el.getBoundingClientRect().top);
    });
  }

  private handleMutations(): void {
    if (isDestroying(this) || !this.#anchorSelector || this.#isAdjusting) {
      return;
    }

    let anchor = this.#element.querySelector(this.#anchorSelector);
    if (!anchor) {
      return;
    }

    let storedTop = this.#positionMap.get(anchor);
    if (storedTop === undefined) {
      return;
    }

    let currentTop = anchor.getBoundingClientRect().top;
    let delta = currentTop - storedTop;

    if (Math.abs(delta) > 1) {
      this.#isAdjusting = true;
      this.#element.scrollTop += delta;
      this.#isAdjusting = false;
    }

    this.capturePositions();
  }
}
