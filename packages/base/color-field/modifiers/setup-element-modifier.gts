import { modifier } from 'ember-modifier';

/**
 * A modifier that calls a callback function with the element once it's inserted.
 * Useful for setting up references or performing initial setup on an element.
 */
export const setupElement = modifier(
  (element: any, [callback]: [(el: any) => void]) => {
    callback(element);
  },
);
