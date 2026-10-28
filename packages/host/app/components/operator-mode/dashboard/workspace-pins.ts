import { cached } from '@glimmer/tracking';

import {
  relationshipEntries,
  resolveRRIReference,
  rri,
  trimJsonExtension,
  type CardResource,
  type FileMetaResource,
  type RealmResourceIdentifier,
  type Relationship,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import { getSearchEntriesResource } from '@cardstack/host/resources/search-entries';

const PIN_FIELD = 'entryPoints';

// A workspace's pins are the `entryPoints` links of its Workspace card, the
// realm's index card, which its Home shows and lets editors change. They're
// read from the search index rather than the card, so no card code loads,
// and the search's realm subscription keeps them current as they're edited.
export class WorkspacePins {
  #resource: ReturnType<typeof getSearchEntriesResource>;

  // `getRealm` answers undefined when the caller shows no pins, and then
  // nothing is fetched.
  constructor(
    parent: object,
    getRealm: () => { realm: string; realmURL: string } | undefined,
  ) {
    this.#resource = getSearchEntriesResource(parent, () => {
      let target = getRealm();
      return target ? indexCardQuery(target.realm, target.realmURL) : undefined;
    });
  }

  // The pinned cards' ids, in the order the workspace lists them. A realm
  // whose index card isn't a Workspace has none.
  @cached
  get cardIds(): RealmResourceIdentifier[] {
    return pinnedCardIds(this.#resource.entries[0]?.item);
  }
}

// The index card alone, with only its pins: a sparse item carries the links
// without expanding the cards they point to.
function indexCardQuery(realm: string, realmURL: string): SearchEntryWireQuery {
  return {
    realms: [realm],
    cardUrls: [new URL('index.json', realmURL).href],
    scope: 'cards',
    fields: { entry: [`item.${PIN_FIELD}`] },
  };
}

function pinnedCardIds(
  item: CardResource | FileMetaResource | undefined,
): RealmResourceIdentifier[] {
  let base = item?.id ?? item?.links?.self;
  if (!base) {
    return [];
  }
  return relationshipEntries(item?.relationships)
    .filter(
      (entry): entry is typeof entry & { index: number } =>
        entry.fieldName === PIN_FIELD && entry.index !== undefined,
    )
    .sort((a, b) => a.index - b.index)
    .flatMap(({ relationship }) => {
      let id = linkedId(relationship, rri(base));
      return id ? [id] : [];
    });
}

// A relative link joins the index card's id; a link naming another realm,
// by URL or registered prefix, is kept in its own form.
function linkedId(
  relationship: Relationship,
  base: RealmResourceIdentifier,
): RealmResourceIdentifier | undefined {
  let data = Array.isArray(relationship.data)
    ? relationship.data[0]
    : relationship.data;
  let ref =
    (data && 'id' in data ? data.id : undefined) ?? relationship.links?.self;
  if (!ref) {
    return undefined;
  }
  try {
    return rri(trimJsonExtension(resolveRRIReference(ref, base)));
  } catch {
    return undefined;
  }
}
