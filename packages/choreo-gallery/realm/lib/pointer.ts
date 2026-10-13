import { modifier } from 'ember-modifier';

export function preventSelect(event: Event) {
  event.preventDefault();
}

/**
 * Keeps clicks inside the element. The host opens an embedded card on a click
 * anywhere inside it, so a live demo embedded in a document marks its own
 * controls with this, and their clicks stay with the demo.
 */
export const ownClicks = modifier((element: HTMLElement) => {
  let stop = (event: Event) => event.stopPropagation();
  element.addEventListener('click', stop);
  return () => element.removeEventListener('click', stop);
});
