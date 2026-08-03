import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';

import Modifier from 'ember-modifier';

import type ScrollPositionService from '@cardstack/host/services/scroll-position-service';

import type { ArgsFor, NamedArgs, PositionalArgs } from 'ember-modifier';

const scrollIntoViewWaiter = buildWaiter('scroll-into-view-modifier');

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
  #resolveObservation?: () => void;
  #waiterToken?: ReturnType<typeof scrollIntoViewWaiter.beginAsync>;
  #lastRunScrolled = false;

  constructor(owner: Owner, args: ArgsFor<ScrollIntoViewModifierSignature>) {
    super(owner, args);
    registerDestructor(this, () => {
      this.finishObservation();
      this.element = undefined as never;
    });
  }

  async modify(
    element: Element,
    [shouldScrollIntoView]: PositionalArgs<ScrollIntoViewModifierSignature>,
    { container, key }: NamedArgs<ScrollIntoViewModifierSignature>,
  ): Promise<void> {
    this.element = element;

    // A zero offset is commonly recorded while a sparse file tree is still
    // growing. It does not represent a meaningful restored position, and
    // treating it as one can leave the selected row below the viewport after
    // the final entries arrive. Positive offsets are intentional user scroll
    // positions and continue to take precedence over selected-row scrolling.
    let restoredScrollPosition =
      container && key
        ? this.scrollPositionService.getScrollPosition(container, key)
        : undefined;
    let shouldRestoreScrollPosition =
      restoredScrollPosition !== undefined && restoredScrollPosition > 0;

    if (
      shouldScrollIntoView &&
      container &&
      key &&
      !shouldRestoreScrollPosition &&
      !this.#lastRunScrolled
    ) {
      await this.scrollIfNotVisible();
      this.#lastRunScrolled = true;
    } else {
      this.#lastRunScrolled = false;
      this.finishObservation();
    }
  }

  private async scrollIfNotVisible() {
    let element = this.element;

    return new Promise((resolve) => {
      this.finishObservation();
      this.#waiterToken = scrollIntoViewWaiter.beginAsync();
      this.#resolveObservation = () => resolve(void 0);
      let intersectionObserver = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) {
          element.scrollIntoView({ block: 'center' });
        }
        if (this.#intersectionObserver === intersectionObserver) {
          this.finishObservation();
        }
      });
      this.#intersectionObserver = intersectionObserver;

      intersectionObserver.observe(element);
    });
  }

  private finishObservation() {
    this.#intersectionObserver?.disconnect();
    this.#intersectionObserver = undefined;
    this.#resolveObservation?.();
    this.#resolveObservation = undefined;
    if (this.#waiterToken) {
      scrollIntoViewWaiter.endAsync(this.#waiterToken);
      this.#waiterToken = undefined;
    }
  }
}
