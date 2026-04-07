import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import Modifier from 'ember-modifier';

import type ScrollPositionService from '@cardstack/host/services/scroll-position-service';

import type { ArgsFor, NamedArgs, PositionalArgs } from 'ember-modifier';

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
  #lastRunScrolled = false;

  constructor(owner: Owner, args: ArgsFor<ScrollIntoViewModifierSignature>) {
    super(owner, args);
    registerDestructor(this, () => {
      this.#intersectionObserver?.disconnect();
      this.#intersectionObserver = undefined;
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
      await this.scrollIfNotVisible();
      this.#lastRunScrolled = true;
    } else {
      this.#lastRunScrolled = false;
      this.#intersectionObserver?.disconnect();
      this.#intersectionObserver = undefined;
    }
  }

  private async scrollIfNotVisible() {
    let element = this.element;

    return new Promise((resolve) => {
      this.#intersectionObserver?.disconnect();
      let intersectionObserver = new IntersectionObserver((entries) => {
        intersectionObserver.disconnect();
        if (this.#intersectionObserver === intersectionObserver) {
          this.#intersectionObserver = undefined;
        }

        if (!entries[0].isIntersecting) {
          element.scrollIntoView({ block: 'center' });
        }

        resolve(void 0);
      });
      this.#intersectionObserver = intersectionObserver;

      intersectionObserver.observe(element);
    });
  }
}
