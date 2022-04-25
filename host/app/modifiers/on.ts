import { modifier } from '@glint/environment-ember-loose/ember-modifier';

const on = modifier(
  (element: HTMLElement, [eventName, handler]: [string, () => unknown]) => {
    element.addEventListener(eventName, handler);

    return () => {
      element.removeEventListener(eventName, handler);
    };
  }
);

export default on;

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    on: typeof on;
  }
}
