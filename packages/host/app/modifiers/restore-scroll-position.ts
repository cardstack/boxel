import { debounce, next } from '@ember/runloop';
import { inject as service } from '@ember/service';

import Modifier, { PositionalArgs } from 'ember-modifier';

import ScrollPositionService from '@cardstack/host/services/scroll-position-service';

interface RestoreScrollPositionModifierArgs {
  Positional: [String];
}

interface RestoreScrollPositionModifierSignature {
  Element: Element;
  Args: RestoreScrollPositionModifierArgs;
}

export default class RestoreScrollPosition extends Modifier<RestoreScrollPositionModifierSignature> {
  @service declare scrollPositionService: ScrollPositionService;

  element!: Element;
  #previousKey: String | undefined;
  #scrollEndListener: (Event) => void;
  #mutationObserver: MutationObserver;

  modify(
    element: Element,
    [key]: PositionalArgs<RestoreScrollPositionModifierSignature>,
  ): void {
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
    let key = this.#previousKey;
    if (this.scrollPositionService.keyHasScrollPosition(key)) {
      let previousScrollTop = this.scrollPositionService.get(key);
      console.log(
        `ummm next render restoring pst ${previousScrollTop} key ${key}`,
      );
      console.log(`st before: ${this.element.scrollTop}`);
      console.log(`scroll height: ${this.element.scrollHeight}`);
      this.element.scrollTop = previousScrollTop;
      console.log(`st after: ${this.element.scrollTop}`);
    }
  }

  handleScrollEnd(e) {
    console.log('scrollend, key is ' + this.#previousKey, e);
    console.log('scrolltop ' + e.target.scrollTop);
    this.scrollPositionService.setKeyScrollPosition(
      this.#previousKey,
      e.target.scrollTop,
    );
  }
}
