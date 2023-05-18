import Modifier from 'ember-modifier';
import { registerDestructor } from '@ember/destroyable';

interface Signature {
  Args: {
    Named: {
      onScrollTop: () => void;
      isDisabled: () => boolean;
    };
  };
}
export class ScrollPaginate extends Modifier<Signature> {
  private interval: number | undefined;

  modify(
    element: HTMLElement,
    _positional: [],
    { onScrollTop, isDisabled }: Signature['Args']['Named']
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

export class ScrollIntoView extends Modifier {
  modify(element: HTMLElement) {
    element.scrollIntoView();
  }
}
