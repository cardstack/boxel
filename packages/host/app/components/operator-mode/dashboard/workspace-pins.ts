import type {
  CardResource,
  FileMetaResource,
  Relationship,
  SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import { getSearchEntriesResource } from '@cardstack/host/resources/search-entries';

const PIN_FIELD = 'entryPoints';
const PIN_KEY = /^entryPoints\.(\d+)$/;

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

  // The pinned cards' URLs, in the order the workspace lists them. A realm
  // whose index card isn't a Workspace has none.
  get cardIds(): string[] {
    return pinnedCardIds(this.#resource.entries[0]?.item);
  }

  get isLoading(): boolean {
    return this.#resource.isLoading;
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

export function pinnedCardIds(
  item: CardResource | FileMetaResource | undefined,
): string[] {
  let relationships = item?.relationships;
  if (!relationships) {
    return [];
  }
  let base = item?.id ?? item?.links?.self;
  return Object.entries(relationships)
    .map(([key, relationship]) => ({
      position: Number(PIN_KEY.exec(key)?.[1]),
      id: linkedId(relationship, base),
    }))
    .filter(
      (pin): pin is { position: number; id: string } =>
        !Number.isNaN(pin.position) && pin.id !== undefined,
    )
    .sort((a, b) => a.position - b.position)
    .map((pin) => pin.id);
}

function linkedId(
  relationship: Relationship | Relationship[],
  base: string | undefined,
): string | undefined {
  let link = Array.isArray(relationship) ? relationship[0] : relationship;
  let data = Array.isArray(link?.data) ? link.data[0] : link?.data;
  let ref = (data && 'id' in data ? data.id : undefined) ?? link?.links?.self;
  if (!ref) {
    return undefined;
  }
  try {
    return new URL(ref, base).href.replace(/\.json$/, '');
  } catch {
    return undefined;
  }
}
