import type { CodeRef } from '@cardstack/runtime-common';

export interface NewCardArgs {
  ref: CodeRef;
  relativeTo: string | undefined;
  realmURL: string;
}

// A selected search result's card/file classification, threaded alongside the
// selected id so the consumer opens the right URL — a card's source file is
// `<id>.json`, a file's id already is its URL — without re-deriving the type
// from the id string (or a stale side registry). Maps directly onto
// `StackItemType`. Absent when a selection did not originate from a search
// entry (e.g. a "Create New" affordance).
export type SearchResultKind = 'card' | 'file';

// Normalizes an id that may carry the card `.json` file convention down to the
// canonical extensionless card id. Only `.json` is stripped: a file entry's id
// (`….md`, `….gts`, …) IS its canonical id, and stripping its extension would
// collide same-named files and mismatch it against open file stack items.
export function removeCardJsonExtension(cardId: string | undefined) {
  return cardId?.replace(/\.json$/, '');
}
