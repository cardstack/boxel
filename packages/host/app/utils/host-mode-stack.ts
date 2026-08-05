// Opening a card that is already behind you in the trail is a navigation *back*
// to it — an in-page "up" link, or a second visit to the same page — so unwind
// to it rather than stacking another copy of a page the user is already inside.
// Pushing is only right for a card not yet on the trail.
//
// Mutates `stack` in place so callers can pass their TrackedArray directly and
// keep the mutation reactive. Host mode and the host submode share this so the
// two trails cannot drift apart.
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

  // lastIndexOf, not indexOf: a hand-crafted or stale `hostModeStack` param can
  // carry the same card twice, and "go back" means the nearest occurrence.
  let index = stack.lastIndexOf(cardId);
  if (index === -1) {
    stack.push(cardId);
  } else {
    stack.splice(index + 1);
  }
}
