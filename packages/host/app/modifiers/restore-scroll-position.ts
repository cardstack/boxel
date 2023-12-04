import { isDestroying } from '@ember/destroyable';
import { debounce, next } from '@ember/runloop';
import { inject as service } from '@ember/service';

import Modifier, { NamedArgs } from 'ember-modifier';

import ScrollPositionService from '@cardstack/host/services/scroll-position-service';

interface RestoreScrollPositionModifierArgs {
  Positional: [];
  Named: { container?: string; key?: string };
}

interface RestoreScrollPositionModifierSignature {
  Element: Element;
  Args: RestoreScrollPositionModifierArgs;
}

export default class RestoreScrollPosition extends Modifier<RestoreScrollPositionModifierSignature> {
  @service declare scrollPositionService: ScrollPositionService;

  element!: Element;

  #mutationObserver: MutationObserver | undefined;
  #scrollEndListener: ((e: Event) => void) | undefined;

  #previousContainer: string | undefined;
  #previousKey: string | undefined;

  modify(
    element: Element,
    // No position args but without this the named ones are undefined
    // eslint-disable-next-line no-empty-pattern
    []: [],
    { container, key }: NamedArgs<RestoreScrollPositionModifierSignature>,
  ): () => void {
    if (!this.#mutationObserver) {
      this.element = element;

      this.#scrollEndListener = this.handleScrollEnd.bind(this);
      element.addEventListener('scrollend', this.#scrollEndListener);

      let mutationObserver = new MutationObserver(
        this.debouncedSetScrollTop.bind(this),
      );
      mutationObserver.observe(element, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      this.#mutationObserver = mutationObserver;
    }

    this.#previousContainer = container;
    this.#previousKey = key;

    return () => {
      if (this.#scrollEndListener) {
        element.removeEventListener('scrollend', this.#scrollEndListener);
      }

      this.#mutationObserver?.disconnect();
    };
  }

  debouncedSetScrollTop() {
    debounce(this, this.setScrollTop, 100);
  }

  nextSetScrollTop() {
    next(this, this.setScrollTop);
  }

  setScrollTop() {
    if (isDestroying(this)) {
      return;
    }

    let container = this.#previousContainer;
    let key = this.#previousKey;
    if (
      container &&
      key &&
      this.scrollPositionService.keyHasScrollPosition(container, key)
    ) {
      let previousScrollTop = this.scrollPositionService.getScrollPosition(
        container,
        key,
      )!;
      this.element.scrollTop = previousScrollTop;
    } else if (
      container &&
      key &&
      this.scrollPositionService.containerHasScrollPosition(container)
    ) {
      this.scrollPositionService.setKeyScrollPosition(
        container,
        key,
        this.element.scrollTop,
      );
    }
  }

  handleScrollEnd(e: Event) {
    if (isDestroying(this)) {
      return;
    }

    if (
      e.target &&
      e.target instanceof HTMLElement &&
      e.target.scrollTop &&
      this.#previousContainer &&
      this.#previousKey
    ) {
      this.scrollPositionService.setKeyScrollPosition(
        this.#previousContainer,
        this.#previousKey,
        e.target.scrollTop,
      );
    }
  }
}
