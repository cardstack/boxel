// Focus helpers shared by the operator-mode and host-mode stacks, which hand
// focus to a card as it opens and back to its opener as it closes.

// The element that has focus, or null when focus is on the page as a whole,
// as it is once the focused element leaves the page.
export function focusedElement(): Element | null {
  let active = document.activeElement;
  return active && active !== document.body ? active : null;
}

// Focuses an element that is still on the page, reporting whether it took
// focus. An element inside an inert subtree, such as a buried card's
// content, doesn't take it.
export function focusIfConnected(element: Element | null | undefined): boolean {
  if (element instanceof HTMLElement && element.isConnected) {
    element.focus({ preventScroll: true });
    return document.activeElement === element;
  }
  return false;
}
