// Focus helpers shared by the operator-mode and host-mode stacks, which hand
// focus to a card as it opens and back to its opener as it closes.

// Focuses an element that is still on the page, reporting whether it took
// focus.
export function focusIfConnected(element: Element | null | undefined): boolean {
  if (element instanceof HTMLElement && element.isConnected) {
    element.focus({ preventScroll: true });
    return document.activeElement === element;
  }
  return false;
}

// Focuses a stack item's root element, which is no control: it is made
// focusable by script only, so it never becomes a Tab stop.
export function focusStackItem(item: HTMLElement) {
  item.tabIndex = -1;
  item.focus({ preventScroll: true });
}

// Whether the target takes typed text, so keys pressed there belong to it and
// focus is not moved out from under it.
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  let tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}
