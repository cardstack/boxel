import { modifier } from 'ember-modifier';

// The last selection state seen per element, so only the unselected ->
// selected transition moves focus. Re-rendering a tile that stays selected
// must not pull focus back from a control the user just focused, like its
// star or menu.
const wasSelected = new WeakMap<HTMLElement, boolean>();

// A tile recreated by a re-render (realm info arriving, the scope filter
// changing the list) looks "just selected" again, so focus moves only when
// nothing else holds it: nothing or the body (the dashboard just opened), the
// button that opened the dashboard, or another tile (an arrow key).
function focusIsAvailable(): boolean {
  let active = document.activeElement;
  return (
    !active ||
    active === document.body ||
    active.hasAttribute('data-workspace-chooser-toggle') ||
    !!active.closest('[data-nav-index]')
  );
}

// Focuses the tile the keyboard cursor moves to. When an arrow key moved it
// there, the tile is also scrolled into view, so the walk down the page stays
// visible; the tile the dashboard opens on takes focus where it is, so the
// page opens at its top.
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
      let fromTile = !!document.activeElement?.closest('[data-nav-index]');
      element.focus({ preventScroll: true });
      if (fromTile) {
        element.scrollIntoView({ block: 'nearest' });
      }
    }
  },
);
