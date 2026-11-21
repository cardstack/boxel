// The entry search grammar: Query V2's (query-v2/search-entry.ts), which
// reads the older spelling as main's did (ADR 042) and the newer members
// (`let`, facets, collapse, explain, rerank, `timeZone`, the newer filter
// members) or refuses them with a code. Main's grammar lived here; every
// caller of this module now reads Query V2's.
export * from './query-v2/search-entry.ts';
