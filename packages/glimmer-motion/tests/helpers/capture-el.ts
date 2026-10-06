import { modifier } from 'ember-modifier';

/** React's `ref={ref}`: fill a {current} ref (or call a setter) with the element */
export type ElementRef<T extends Element = Element> = { current: T | null };
export const createRef = <T extends Element = Element>(): ElementRef<T> => ({
  current: null,
});

export const captureEl = modifier(
  (el: Element, [target]: [ElementRef<any> | ((el: Element) => void)]) => {
    if (typeof target === 'function') {
      target(el);
    } else {
      target.current = el;
    }
    return () => {
      if (typeof target !== 'function') {
        target.current = null;
      }
    };
  },
);

/** fixtures that scroll the window in a layout effect, before drag is wired up */
export const scrollWindowTo = modifier((_el: Element, [y]: [number]) => {
  window.scrollTo(0, y);
});
