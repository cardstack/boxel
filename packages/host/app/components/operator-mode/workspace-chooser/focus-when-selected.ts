import { modifier } from 'ember-modifier';

// Per-element record of the last-seen selection state, so we only act on the
// unselected -> selected transition. Without this, the modifier would re-run
// whenever the tile re-renders while still selected and could yank focus back
// to the tile from a control the user just focused (a card's favorite/options
// button), since those controls live outside the tile element.
const wasSelected = new WeakMap<HTMLElement, boolean>();

// The WeakMap is keyed per element, so a re-render that recreates the tile
// (async realm info/counts arriving, the sort filter re-rendering the list)
// makes the still-selected tile look "just selected" again. Focus may only
// move to the tile when it isn't actively engaged elsewhere: on nothing/body
// (the chooser just opened), on the toggle button that opens the chooser
// (which keeps focus after activation, and hands it off to the default tile
// so arrow-key navigation works immediately), or on another tile (arrow-key
// navigation). Otherwise a tile recreation would steal focus mid-interaction
// from a control like the sort select — turning its next Enter into a click
// on the workspace tile.
function focusIsAvailable(): boolean {
  let active = document.activeElement;
  return (
    !active ||
    active === document.body ||
    active.hasAttribute('data-workspace-chooser-toggle') ||
    !!active.closest('[data-nav-index]')
  );
}

// When a workspace-chooser tile becomes the keyboard-selected item, move DOM
// focus to it and scroll it into view, so the selection is visible and the
// tile is reachable as arrow-key navigation walks the list.
export default modifier(
  (element: HTMLElement, [isSelected]: [boolean | undefined]) => {
    let selected = !!isSelected;
    let justSelected = selected && !wasSelected.get(element);
    wasSelected.set(element, selected);
    if (
      justSelected &&
      document.activeElement !== element &&
      focusIsAvailable()
    ) {
      element.focus();
      element.scrollIntoView({ block: 'nearest' });
    }
  },
);
