import { modifier } from 'ember-modifier';

// The last selection state seen per element, so only the unselected ->
// selected transition moves focus. Re-rendering an item that stays selected
// must not pull focus back from a control the user just focused, like its
// star or menu.
const wasSelected = new WeakMap<HTMLElement, boolean>();

// An item recreated by a re-render (realm info arriving, a filter or sort
// changing the list) looks "just selected" again, so focus moves only when
// nothing else holds it: nothing or the body (the list just opened), the
// button that opened it, or another item (an arrow key). Otherwise it would
// take focus from a control like the sort select, turning its next Enter into
// a click on the item.
function focusIsAvailable(): boolean {
  let active = document.activeElement;
  return (
    !active ||
    active === document.body ||
    active.hasAttribute('data-workspace-chooser-toggle') ||
    !!active.closest('[data-nav-index]')
  );
}

// Less than half of it shows, so a sliver at the window's edge still counts.
function isOffScreen(element: HTMLElement): boolean {
  let { top, bottom, height } = element.getBoundingClientRect();
  let shown = Math.min(bottom, window.innerHeight) - Math.max(top, 0);
  return shown < height / 2;
}

// Focuses the item the keyboard cursor moves to. When an arrow key moved it
// there, the item is also scrolled into view, so the walk down the page stays
// visible. The item the list opens on is scrolled into view too, or with
// `scrollOnOpen='when-off-screen'` only when most of it is out of view, so a
// page that opens on an item near its top stays at its top.
export default modifier(
  (
    element: HTMLElement,
    [isSelected]: [boolean | undefined],
    {
      scrollOnOpen = 'always',
    }: { scrollOnOpen?: 'always' | 'when-off-screen' },
  ) => {
    let selected = !!isSelected;
    let justSelected = selected && !wasSelected.get(element);
    wasSelected.set(element, selected);
    if (
      justSelected &&
      document.activeElement !== element &&
      focusIsAvailable()
    ) {
      let fromItem = !!document.activeElement?.closest('[data-nav-index]');
      element.focus({ preventScroll: true });
      if (fromItem || scrollOnOpen === 'always' || isOffScreen(element)) {
        element.scrollIntoView({ block: 'nearest' });
      }
    }
  },
);
