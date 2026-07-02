import Modifier from 'ember-modifier';

export class CaptureElement extends Modifier<{
  Args: {
    Positional: [(el: HTMLElement) => void];
  };
  Element: HTMLElement;
}> {
  #element: HTMLElement | null = null;

  modify(el: HTMLElement, [callback]: [(el: HTMLElement) => void]) {
    if (el !== this.#element) {
      this.#element = el;
      callback(el);
    }
  }
}

export class BindPointerDown extends Modifier<{
  Args: {
    Positional: [(event: PointerEvent) => void];
  };
  Element: HTMLElement;
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

  willDestroy() {
    if (this.#element && this.#handler) {
      this.#element.removeEventListener('pointerdown', this.#handler);
    }
  }
}
