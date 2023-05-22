import Modifier from 'ember-modifier';
import { registerDestructor } from '@ember/destroyable';

interface PaginateSignature {
  Args: {
    Named: {
      onScrollTop: () => void;
      isDisabled: () => boolean;
    };
  };
}

export class ScrollPaginate extends Modifier<PaginateSignature> {
  private interval: number | undefined;

  modify(
    element: HTMLElement,
    _positional: [],
    { onScrollTop, isDisabled }: PaginateSignature['Args']['Named']
  ) {
    this.interval = setInterval(() => {
      if (element.scrollTop === 0 && !isDisabled()) {
        onScrollTop();
      }
    }, 50) as unknown as number;
    registerDestructor(this, () => {
      clearInterval(this.interval);
    });
  }
}

interface ScrollSignature {
  Args: {
    Named: {
      register: (scrollIntoView: () => void) => void;
    };
  };
}
export class ScrollIntoView extends Modifier<ScrollSignature> {
  modify(
    element: HTMLElement,
    _positional: [],
    { register }: ScrollSignature['Args']['Named']
  ) {
    element.scrollIntoView();
    register(() => element.scrollIntoView());
  }
}
