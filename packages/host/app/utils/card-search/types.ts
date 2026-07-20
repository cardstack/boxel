import type { CodeRef } from '@cardstack/runtime-common';

export interface NewCardArgs {
  ref: CodeRef;
  relativeTo: string | undefined;
  realmURL: string;
}

// Whether a chosen search result is a card instance or a file.
export type SearchItemKind = 'card' | 'file';

// A chosen existing search result: its id tagged with its kind. Used as the
// selection payload throughout the card-search components so a mixed card/file
// chooser can report each pick's kind without inspecting the id.
export interface SelectedSearchItem {
  id: string;
  kind: SearchItemKind;
}

// The selection payload a result tile emits: an existing card/file, or the
// "create new card" affordance.
export type SearchSelection = SelectedSearchItem | NewCardArgs;

export function isNewCardArgs(item: SearchSelection): item is NewCardArgs {
  return 'realmURL' in item;
}

// Normalizes an id that may carry the card `.json` file convention down to the
// canonical extensionless card id. Only `.json` is stripped: a file entry's id
// (`….md`, `….gts`, …) IS its canonical id, and stripping its extension would
// collide same-named files and mismatch it against open file stack items.
export function removeCardJsonExtension(cardId: string | undefined) {
  return cardId?.replace(/\.json$/, '');
}
