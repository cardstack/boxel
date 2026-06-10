import { modifier } from 'ember-modifier';

// When a workspace-chooser tile becomes the keyboard-selected item, move DOM
// focus to it and scroll it into view, so the selection is visible and the
// tile is reachable as arrow-key navigation walks the list.
export default modifier(
  (element: HTMLElement, [isSelected]: [boolean | undefined]) => {
    if (isSelected && document.activeElement !== element) {
      element.focus();
      element.scrollIntoView({ block: 'nearest' });
    }
  },
);
