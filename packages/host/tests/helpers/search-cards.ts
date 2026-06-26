import {
  searchEntryWireQueryFromQuery,
  parseSearchEntryQueryFromPayload,
  type Query,
  type CardResource,
  type FileMetaResource,
  type QueryResultsMeta,
  type Realm,
} from '@cardstack/runtime-common';

// Test-only: fetch the card/file-meta serializations matching a card-rooted
// `Query` through the v2 search-entry engine, returning them in the
// `{ data, included, meta }` collection shape index assertions read. Requests
// the data-only fieldset (one full `item` per entry); the top-level items land
// in `data`, their transitively-linked resources in `included`.
export async function searchCardsForTest(
  engine: Realm['realmIndexQueryEngine'],
  cardQuery: Query,
  opts?: Parameters<Realm['realmIndexQueryEngine']['searchEntries']>[1],
): Promise<{
  data: (CardResource | FileMetaResource)[];
  included: (CardResource | FileMetaResource)[];
  meta: QueryResultsMeta;
}> {
  let doc = await engine.searchEntries(
    parseSearchEntryQueryFromPayload(
      searchEntryWireQueryFromQuery(cardQuery, { fields: ['item'] }),
    ),
    opts,
  );
  // Key by the full `(type, id)` the search-entry `item` relationship carries,
  // not `id` alone — matches the wire contract (and the store's resolver).
  let itemKeys = new Set<string>();
  for (let entry of doc.data) {
    let ref = entry.relationships.item?.data;
    if (ref) {
      itemKeys.add(`${ref.type}:${ref.id}`);
    }
  }
  let itemsByKey = new Map<string, CardResource | FileMetaResource>();
  let included: (CardResource | FileMetaResource)[] = [];
  for (let resource of doc.included ?? []) {
    if (resource.type !== 'card' && resource.type !== 'file-meta') {
      continue;
    }
    if (resource.id == null) {
      continue;
    }
    let key = `${resource.type}:${resource.id}`;
    if (itemKeys.has(key)) {
      itemsByKey.set(key, resource);
    } else {
      included.push(resource);
    }
  }
  let data = doc.data
    .map((entry) => entry.relationships.item?.data)
    .filter((ref): ref is NonNullable<typeof ref> => ref != null)
    .map((ref) => itemsByKey.get(`${ref.type}:${ref.id}`))
    .filter((item): item is CardResource | FileMetaResource => Boolean(item));
  return { data, included, meta: doc.meta };
}
