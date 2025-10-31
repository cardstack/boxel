import { isDestroying } from '@ember/destroyable';
import { debounce } from '@ember/runloop';
import { inject as service } from '@ember/service';

import Modifier from 'ember-modifier';

import type ScrollPositionService from '@cardstack/host/services/scroll-position-service';

import type { NamedArgs } from 'ember-modifier';

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

  #element!: Element;

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
      this.#element = element;

      this.#scrollEndListener = this.persistScrollTop.bind(this);
      element.addEventListener('scrollend', this.#scrollEndListener);

      let mutationObserver = new MutationObserver(
        this.debouncedRestoreOrPersistScrollTop.bind(this),
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

  private debouncedRestoreOrPersistScrollTop() {
    debounce(this, this.restoreOrPersistScrollTop, 100);
  }

  private restoreOrPersistScrollTop() {
    if (isDestroying(this)) {
      return;
    }

    let container = this.#previousContainer;
    let key = this.#previousKey;
    if (container && key) {
      let shouldRestorePosition =
        this.scrollPositionService.keyHasScrollPosition(container, key);

      if (shouldRestorePosition) {
        let previousScrollTop = this.scrollPositionService.getScrollPosition(
          container,
          key,
        )!;
        this.#element.scrollTop = previousScrollTop;
        return;
      }

      // Key differs, old position can be forgotten
      let shouldReplaceStoredPosition =
        this.scrollPositionService.containerHasScrollPosition(container);

      if (shouldReplaceStoredPosition) {
        this.scrollPositionService.setScrollPosition(
          container,
          key,
          this.#element.scrollTop,
        );
      }
    }
  }

  private persistScrollTop(e: Event) {
    if (isDestroying(this)) {
      return;
    }

    if (
      e.target &&
      e.target instanceof HTMLElement &&
      e.target.scrollTop != undefined &&
      this.#previousContainer &&
      this.#previousKey
    ) {
      this.scrollPositionService.setScrollPosition(
        this.#previousContainer,
        this.#previousKey,
        e.target.scrollTop,
      );
    }
  }
}
