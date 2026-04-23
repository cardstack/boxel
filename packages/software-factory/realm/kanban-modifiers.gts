import Modifier from 'ember-modifier';

export class CaptureElement extends Modifier<{
  Element: HTMLElement;
  Args: {
    Positional: [(el: HTMLElement) => void];
  };
}> {
  modify(el: HTMLElement, [callback]: [(el: HTMLElement) => void]) {
    callback(el);
  }
}

export class BindPointerDown extends Modifier<{
  Element: HTMLElement;
  Args: {
    Positional: [(event: PointerEvent) => void];
  };
}> {
  #element: HTMLElement | null = null;
  #handler: ((event: PointerEvent) => void) | null = null;

  modify(el: HTMLElement, [handler]: [(event: PointerEvent) => void]) {
    if (this.#element && this.#handler) {
      this.#element.removeEventListener('pointerdown', this.#handler);
    }
    el.addEventListener('pointerdown', handler);
    this.#element = el;
    this.#handler = handler;
  }

  willRemove() {
    if (this.#element && this.#handler) {
      this.#element.removeEventListener('pointerdown', this.#handler);
    }
  }
}
