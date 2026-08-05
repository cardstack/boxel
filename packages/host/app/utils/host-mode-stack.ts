// The trail can hold the same card more than once — `hostModeStack` is accepted
// from the URL verbatim — so every lookup here resolves to the *topmost*
// occurrence, the copy the user can actually see and act on.
//
// Both functions mutate `stack` in place so callers can pass their TrackedArray
// directly and keep the mutation reactive. Host mode and the host submode share
// them so the two trails cannot drift apart.

// Opening a card that is already behind you in the trail is a navigation *back*
// to it — an in-page "up" link, or a second visit to the same page — so unwind
// to it rather than stacking another copy of a page the user is already inside.
// Pushing is only right for a card not yet on the trail.
export function unwindOrPush(
  stack: string[],
  cardId: string,
  primaryCardId: string | null,
): void {
  if (cardId === primaryCardId) {
    // the root: everything above it closes
    stack.splice(0, stack.length);
    return;
  }

  // "Go back" means the nearest occurrence, so unwind to the topmost copy.
  let index = stack.lastIndexOf(cardId);
  if (index === -1) {
    stack.push(cardId);
  } else {
    stack.splice(index + 1);
  }
}

// Close removes the topmost copy of a card, since that is the one on screen: a
// close button renders only on the stack's top card, and a breadcrumb click
// closes the crumbs above it from the top down. Returns whether the trail
// changed, so callers only persist when it did.
export function removeTopmost(stack: string[], cardId: string): boolean {
  let index = stack.lastIndexOf(cardId);
  if (index === -1) {
    return false;
  }

  stack.splice(index, 1);
  return true;
}
