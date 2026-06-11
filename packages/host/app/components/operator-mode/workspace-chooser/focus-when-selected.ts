import { modifier } from 'ember-modifier';

// Per-element record of the last-seen selection state, so we only act on the
// unselected -> selected transition. Without this, the modifier would re-run
// whenever the tile re-renders while still selected and could yank focus back
// to the tile from a control the user just focused (a card's favorite/options
// button), since those controls live outside the tile element.
const wasSelected = new WeakMap<HTMLElement, boolean>();

// When a workspace-chooser tile becomes the keyboard-selected item, move DOM
// focus to it and scroll it into view, so the selection is visible and the
// tile is reachable as arrow-key navigation walks the list.
export default modifier(
  (element: HTMLElement, [isSelected]: [boolean | undefined]) => {
    let selected = !!isSelected;
    let justSelected = selected && !wasSelected.get(element);
    wasSelected.set(element, selected);
    if (justSelected && document.activeElement !== element) {
      element.focus();
      element.scrollIntoView({ block: 'nearest' });
    }
  },
);
