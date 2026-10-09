// The title a card shows before it has one of its own. Shared so the places
// that need to recognize the placeholder — not just print it — can't drift
// from the spelling `cardTitle` computes.
export function untitledCardTitle(cardClass: { displayName: string }): string {
  return `Untitled ${cardClass.displayName}`;
}
