import { cached } from '@glimmer/tracking';

import {
  baseRRI,
  RealmPaths,
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

import type { RealmEventContent } from '@cardstack/base/matrix-event';

const PIN_FIELD = 'entryPoints';
const WORKSPACE_TYPE = { module: baseRRI('workspace'), name: 'Workspace' };

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
    this.#resource = getSearchEntriesResource(
      parent,
      () => {
        let target = getRealm();
        return target
          ? indexCardQuery(target.realm, target.realmURL)
          : undefined;
      },
      {
        refreshOn: (event) => {
          let target = getRealm();
          return target ? indexCardReindexed(event, target.realmURL) : false;
        },
        refreshPromptly: true,
      },
    );
  }

  // The pinned cards' ids, in the order the workspace lists them, each once.
  // A realm whose index card isn't a Workspace has none.
  @cached
  get cardIds(): RealmResourceIdentifier[] {
    return pinnedCardIds(this.#resource.entries[0]?.item);
  }

  // Whether the realm's index card is a Workspace, and so can hold pins:
  // undefined until a search answers.
  get isWorkspace(): boolean | undefined {
    if (this.#resource.entries.length > 0) {
      return true;
    }
    return this.#resource.isLoading || this.failed ? undefined : false;
  }

  // Whether the last search failed with no earlier answer to fall back on.
  get failed(): boolean {
    return (
      !this.#resource.isLoading &&
      this.#resource.entries.length === 0 &&
      (this.#resource.errors?.length ?? 0) > 0
    );
  }
}

// The index card alone, when it's a Workspace, with only its pins: a sparse item carries the links
// without expanding the cards they point to.
function indexCardQuery(realm: string, realmURL: string): SearchEntryWireQuery {
  return {
    realms: [realm],
    cardUrls: [indexCardURL(realmURL)],
    filter: { 'item.on': WORKSPACE_TYPE },
    scope: 'cards',
    fields: { entry: [`item.${PIN_FIELD}`] },
  };
}

function indexCardURL(realmURL: string): string {
  return new RealmPaths(new URL(realmURL)).fileURL('index.json').href;
}

// Pins can only move when the index card is reindexed: a write to it, which
// also covers its other fields, or a reindex of the realm that rewrites it.
// On the split index path, an edit to a pinned card re-renders the index
// card's HTML without reindexing it, so it isn't one of these. The fused path
// (SQLite) reindexes it, which only costs an extra search.
export function indexCardReindexed(
  event: RealmEventContent,
  realmURL: string,
): boolean {
  if (event.eventName !== 'index' || event.indexType !== 'incremental') {
    return false;
  }
  // A pass too large to list what it invalidated may have moved any card of
  // the realm, the index card among them.
  if ('realmWide' in event) {
    return true;
  }
  let indexCard = trimJsonExtension(indexCardURL(realmURL));
  return (event.invalidations ?? []).some(
    (url) => trimJsonExtension(url) === indexCard,
  );
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
    })
    .filter((id, index, ids) => ids.indexOf(id) === index);
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
