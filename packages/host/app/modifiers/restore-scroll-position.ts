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
  #previousContainer: String | undefined;
  #previousKey: String | undefined;
  #scrollEndListener: (Event) => void;
  #mutationObserver: MutationObserver;

  modify(
    element: Element,
    // No named args but without this the named ones are undefined
    // eslint-disable-next-line no-empty-pattern
    []: [],
    { container, key }: NamedArgs<RestoreScrollPositionModifierSignature>,
  ): void {
    console.log(`wha`, container, key);
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
      element.removeEventListener('scrollend', this.#scrollEndListener);
      this.#mutationObserver.disconnect();
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
    if (this.scrollPositionService.keyHasScrollPosition(container, key)) {
      let previousScrollTop = this.scrollPositionService.get(container, key);
      console.log(
        `ummm next render restoring pst ${previousScrollTop} container ${container} key ${key}`,
      );
      console.log(`st before: ${this.element.scrollTop}`);
      console.log(`scroll height: ${this.element.scrollHeight}`);
      this.element.scrollTop = previousScrollTop;
      console.log(`st after: ${this.element.scrollTop}`);
    } else if (
      this.scrollPositionService.containerHasScrollPosition(container)
    ) {
      this.#scrollEndListener({ target: this.element });
    }
  }

  handleScrollEnd(e) {
    if (isDestroying(this)) {
      return;
    }

    console.log(
      'scrollend, container is ' +
        this.#previousContainer +
        ' key is ' +
        this.#previousKey,
      e,
    );
    console.log('scrolltop ' + e.target.scrollTop);
    this.scrollPositionService.setKeyScrollPosition(
      this.#previousContainer,
      this.#previousKey,
      e.target.scrollTop,
    );
  }
}
