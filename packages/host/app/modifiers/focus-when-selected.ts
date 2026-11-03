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

// Less than half of it shows within the window and every scroller around it,
// so a sliver at an edge still counts as off screen.
function isOffScreen(element: HTMLElement): boolean {
  let { top, bottom, height } = element.getBoundingClientRect();
  let shownTop = Math.max(top, 0);
  let shownBottom = Math.min(bottom, window.innerHeight);
  for (let el = element.parentElement; el; el = el.parentElement) {
    if (getComputedStyle(el).overflowY !== 'visible') {
      let clip = el.getBoundingClientRect();
      shownTop = Math.max(shownTop, clip.top);
      shownBottom = Math.min(shownBottom, clip.bottom);
    }
  }
  return shownBottom - shownTop < height / 2;
}

// Focuses the item the keyboard cursor moves to. When an arrow key moved it
// there, the item is also scrolled into view, so the walk down the page stays
// visible. The item the list opens on is scrolled into view too, unless
// `scrollOnOpen='never'`: then the page opens at its top, and the item takes
// focus only if it is in view, since focus out of sight would hand Enter to
// an item nobody can see.
export default modifier(
  (
    element: HTMLElement,
    [isSelected]: [boolean | undefined],
    { scrollOnOpen = 'always' }: { scrollOnOpen?: 'always' | 'never' },
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
      if (!fromItem && scrollOnOpen === 'never' && isOffScreen(element)) {
        return;
      }
      element.focus({ preventScroll: true });
      if (fromItem || scrollOnOpen === 'always') {
        element.scrollIntoView({ block: 'nearest' });
      }
    }
  },
);
