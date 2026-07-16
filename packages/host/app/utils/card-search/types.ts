import type { CodeRef } from '@cardstack/runtime-common';

export interface NewCardArgs {
  ref: CodeRef;
  relativeTo: string | undefined;
  realmURL: string;
}

// Normalizes an id that may carry the card `.json` file convention down to the
// canonical extensionless card id. Only `.json` is stripped: a file entry's id
// (`….md`, `….gts`, …) IS its canonical id, and stripping its extension would
// collide same-named files and mismatch it against open file stack items.
export function removeCardJsonExtension(cardId: string | undefined) {
  return cardId?.replace(/\.json$/, '');
}
