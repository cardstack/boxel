// The rows of named cards, matched on the index row's own `url` column rather
// than on its search document. An internal filter node the engine compiles to
//
//   i.url IN (<id>, <id>.json, …) OR i.search_doc IS NULL
//
// A policy-scoped search leaves out the cards that hold a realm's
// authorization (`withoutAuthorization` in card-operations/policy-query.ts)
// with `not` of this node. As `eq: { id }` the same test read
// `search_doc ->> 'id'`, which unpacks every candidate row's whole search
// document; `i.url` is a column of the row itself.
//
// What it matches, for a card id `<id>`:
// - the card's `instance` row, whose `url` is `<id>.json` (its `id` is `<id>`);
// - a `file` row whose `url` is `<id>`, which is what its `id` would be;
// - the card's own `.json` `file` row, which `eq: { id }` never matched: the
//   same card, as a file;
// - a row with no search document, which `eq: { id }` read as unknown, so
//   under `not` it left the row out. The node keeps that: such a row has no id
//   to tell it from a named card.
// So under `not` it leaves out every row the `eq: { id }` tests did, and the
// card's own `.json` file row besides.
//
// The node is known by its shape, so it survives the copies a scoped query
// goes through on its way to the engine (a scope is cached, a query is
// cloned). Unlike the union's `realmAdmission`, which names realms a caller
// reads outright and so must never be made outside the engine, this node can
// only narrow: by itself it matches the named cards' rows, and under `not` it
// leaves them out. And no request can spell it: the wire grammar refuses a
// filter member it doesn't know.

import type { Filter } from './query.ts';

export interface CardIdentity {
  cardIdentity: { ids: string[] };
}

export function cardIdentityFilter(ids: string[]): Filter {
  let node: CardIdentity = { cardIdentity: { ids: [...ids] } };
  return node as unknown as Filter;
}

export function isCardIdentityFilter(filter: unknown): filter is CardIdentity {
  if (typeof filter !== 'object' || filter === null) {
    return false;
  }
  let ids = (filter as { cardIdentity?: { ids?: unknown } }).cardIdentity?.ids;
  return (
    Object.keys(filter).length === 1 &&
    Array.isArray(ids) &&
    ids.every((id) => typeof id === 'string')
  );
}

// The `url` values a card id's rows are indexed under.
export function cardIdentityURLs(ids: readonly string[]): string[] {
  return ids.flatMap((id) => [id, `${id}.json`]);
}
