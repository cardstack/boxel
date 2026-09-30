import { modifier } from 'ember-modifier';

/** React's ref on the group element */
export const captureGroup = modifier(
  (el: Element, [ref]: [{ current: Element | null }]) => {
    ref.current = el;
    return () => {
      ref.current = null;
    };
  },
);
