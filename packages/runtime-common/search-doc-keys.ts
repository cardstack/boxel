// Synthetic keys stamped into a row's `search_doc` after render (see
// index-runner/{card,file}-indexer.ts). They are not real card/file fields, but
// the query engine (index-query-engine.ts `getField` shim + `fieldEqFilter`),
// the client-side matcher (instance-filter-matcher.ts), and the search-doc
// parity differ (searchable-parity.ts) all treat them as addressable so cards
// and files can be filtered/sorted through one query. Keeping the spellings in
// one module means a rename is a single-file change rather than a cross-package
// grep.
//
// `_`-prefixed top-level search-doc keys are reserved for these synthetics:
// the query engine special-cases them by leaf name before any field-definition
// lookup (e.g. `_isCardInstanceFile` compiles to an existence test, not a
// value comparison), and the client-side matcher treats any unshimmed
// `_`-prefixed key as server-only. A user-defined field whose name collides
// with one of these at the search-doc top level would silently get the
// synthetic's semantics instead of its own value's.

// The row's display title under a kind-neutral key (a card's is its
// `cardTitle`, a file's is its name), so one mixed query can substring-match
// and A-Z sort cards and files uniformly.
export const CARD_TITLE_KEY = '_title';

// The card type's friendly display name (see `friendlyCardType`).
export const CARD_TYPE_KEY = '_cardType';

// Stamped `true` only on the `file` row of a dual-indexed card `.json` (the
// same URL also has an `instance` row); absent on card-instance rows and on
// plain file rows. So the canonical spelling that keeps cards + plain files and
// drops the duplicate `.json` file row is `eq: false` (which matches an absent
// key too), not `eq: true`.
export const CARD_INSTANCE_FILE_KEY = '_isCardInstanceFile';

export const SYNTHETIC_SEARCH_DOC_KEYS = [
  CARD_TITLE_KEY,
  CARD_TYPE_KEY,
  CARD_INSTANCE_FILE_KEY,
] as const;

export function isSyntheticSearchDocKey(key: string): boolean {
  return (SYNTHETIC_SEARCH_DOC_KEYS as readonly string[]).includes(key);
}
