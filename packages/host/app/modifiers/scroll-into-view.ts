import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';

import Modifier from 'ember-modifier';

import type ScrollPositionService from '@cardstack/host/services/scroll-position-service';

import type { ArgsFor, NamedArgs, PositionalArgs } from 'ember-modifier';

// The scroll happens in an IntersectionObserver callback, which the runloop
// does not track. The waiter keeps `settled()` pending until that callback has
// run (or the observer is torn down), so a test that clicks an item sees it
// already scrolled into view.
const waiter = buildWaiter('scroll-into-view:intersection-waiter');

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
  #intersectionObserver?: IntersectionObserver;
  #waiterToken?: unknown;
  #pendingContainer?: string;
  #lastRunScrolled = false;

  constructor(owner: Owner, args: ArgsFor<ScrollIntoViewModifierSignature>) {
    super(owner, args);
    registerDestructor(this, () => {
      this.disconnectObserver();
      this.element = undefined as never;
    });
  }

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
      await this.scrollIfNotVisible(container);
      this.#lastRunScrolled = true;
    } else {
      this.#lastRunScrolled = false;
      this.disconnectObserver();
    }
  }

  private disconnectObserver() {
    this.#intersectionObserver?.disconnect();
    this.#intersectionObserver = undefined;
    if (this.#waiterToken) {
      waiter.endAsync(this.#waiterToken);
      this.#waiterToken = undefined;
    }
    if (this.#pendingContainer) {
      this.scrollPositionService.endScrollIntoView(this.#pendingContainer);
      this.#pendingContainer = undefined;
    }
  }

  private async scrollIfNotVisible(container: string) {
    let element = this.element;

    return new Promise((resolve) => {
      this.disconnectObserver();
      let intersectionObserver = new IntersectionObserver((entries) => {
        intersectionObserver.disconnect();

        if (!entries[0].isIntersecting) {
          element.scrollIntoView({ block: 'center' });
        }

        if (this.#intersectionObserver === intersectionObserver) {
          this.disconnectObserver();
        }

        resolve(void 0);
      });
      this.#intersectionObserver = intersectionObserver;
      this.#waiterToken = waiter.beginAsync();
      this.#pendingContainer = container;
      this.scrollPositionService.beginScrollIntoView(container);

      intersectionObserver.observe(element);
    });
  }
}
