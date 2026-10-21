import { registerDestructor, isDestroying } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { cancel, debounce } from '@ember/runloop';
import type { Timer } from '@ember/runloop';
import { service } from '@ember/service';

import Modifier from 'ember-modifier';

import type ScrollPositionService from '@cardstack/host/services/scroll-position-service';

import type { ArgsFor, NamedArgs } from 'ember-modifier';

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
  #debounceTimer: Timer | undefined;

  constructor(
    owner: Owner,
    args: ArgsFor<RestoreScrollPositionModifierSignature>,
  ) {
    super(owner, args);
    registerDestructor(this, () => this.cleanup());
  }

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
      this.cleanup();
    };
  }

  private debouncedRestoreOrPersistScrollTop() {
    this.#debounceTimer = debounce(this, this.restoreOrPersistScrollTop, 100);
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

      // The stored position belongs to another key, so it is forgotten rather
      // than overwritten with the current scrollTop. The current scrollTop can
      // still be the old key's position: the newly selected item scrolls
      // itself into view from an IntersectionObserver callback that may land
      // after this debounce. The new key's position is recorded by the
      // scrollend listener once something actually scrolls.
      if (this.scrollPositionService.containerHasScrollPosition(container)) {
        this.scrollPositionService.forgetScrollPosition(container);
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

  private cleanup() {
    if (this.#scrollEndListener) {
      this.#element?.removeEventListener('scrollend', this.#scrollEndListener);
    }
    this.#mutationObserver?.disconnect();
    if (this.#debounceTimer) {
      cancel(this.#debounceTimer);
      this.#debounceTimer = undefined;
    }
    this.#mutationObserver = undefined;
    this.#scrollEndListener = undefined;
    this.#previousContainer = undefined;
    this.#previousKey = undefined;
  }
}
