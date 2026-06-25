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
  let itemIds = new Set<string>();
  for (let entry of doc.data) {
    let id = entry.relationships.item?.data?.id;
    if (id) {
      itemIds.add(id);
    }
  }
  let itemsById = new Map<string, CardResource | FileMetaResource>();
  let included: (CardResource | FileMetaResource)[] = [];
  for (let resource of doc.included ?? []) {
    if (resource.type !== 'card' && resource.type !== 'file-meta') {
      continue;
    }
    if (resource.id == null) {
      continue;
    }
    if (itemIds.has(resource.id)) {
      itemsById.set(resource.id, resource);
    } else {
      included.push(resource);
    }
  }
  let data = doc.data
    .map((entry) => entry.relationships.item?.data?.id)
    .filter((id): id is string => typeof id === 'string')
    .map((id) => itemsById.get(id))
    .filter((item): item is CardResource | FileMetaResource => Boolean(item));
  return { data, included, meta: doc.meta };
}
