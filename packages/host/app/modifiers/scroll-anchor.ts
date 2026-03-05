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

  private capturePositions(containerTop?: number): void {
    if (this.#isAdjusting || !this.#trackSelector) {
      return;
    }
    this.#positionMap.clear();
    let relativeContainerTop =
      containerTop ?? this.#element.getBoundingClientRect().top;
    let elements = this.#element.querySelectorAll(this.#trackSelector);
    elements.forEach((el) => {
      this.#positionMap.set(
        el,
        el.getBoundingClientRect().top - relativeContainerTop,
      );
    });
  }

  private handleMutations(): void {
    if (isDestroying(this) || this.#isAdjusting) {
      return;
    }
    let containerTop = this.#element.getBoundingClientRect().top;

    if (this.#anchorSelector) {
      let anchor = this.#element.querySelector(this.#anchorSelector);
      let storedTop = anchor ? this.#positionMap.get(anchor) : undefined;

      if (anchor && storedTop !== undefined) {
        let currentTop = anchor.getBoundingClientRect().top - containerTop;
        let delta = currentTop - storedTop;

        if (Math.abs(delta) > 1) {
          this.#isAdjusting = true;
          this.#element.scrollTop += delta;
          this.#isAdjusting = false;
        }
      }
    }

    // Always recapture after any mutation so newly added elements
    // are tracked for future adjustments.
    this.capturePositions(containerTop);
  }
}
