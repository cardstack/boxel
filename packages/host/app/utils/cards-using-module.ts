import {
  identifyCard,
  isCardDef,
  isResolvedCodeRef,
  searchEntryWireQueryFromQuery,
  trimExecutableExtension,
  type Loader,
  type ResolvedCodeRef,
  type SearchEntryResults,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

// The card definitions a module declares itself. A card it only re-exports
// belongs to the module that declares it, and deleting this one leaves it be.
// `toURL` puts a module identifier in URL form: the loader names a module in a
// prefix-mapped realm by its prefix.
export async function cardDefinitionsInModule(
  loader: Loader,
  moduleURL: URL,
  toURL: (identifier: string) => string,
): Promise<ResolvedCodeRef[]> {
  let module = trimExecutableExtension(moduleURL.href);
  let exports = await loader.import<Record<string, unknown>>(module);
  let refs: ResolvedCodeRef[] = [];
  for (let value of Object.values(exports)) {
    if (!isCardDef(value)) {
      continue;
    }
    let ref = identifyCard(value);
    if (
      ref &&
      isResolvedCodeRef(ref) &&
      trimExecutableExtension(toURL(ref.module)) === module &&
      !refs.some((r) => r.name === ref.name)
    ) {
      refs.push(ref);
    }
  }
  return refs;
}

// Cards that adopt from any of `definitions`, directly or through a subclass.
// Entries carry each card's id and serialization, so no card has to load.
export function cardsUsingDefinitionsQuery(
  definitions: ResolvedCodeRef[],
  page: { number: number; size: number },
): SearchEntryWireQuery {
  let query = searchEntryWireQueryFromQuery(
    { filter: { any: definitions.map((type) => ({ type })) } },
    { fields: ['item'], scope: 'cards' },
  );
  query.page = page;
  return query;
}

export interface CardUsingDefinition {
  id: string;
  title: string;
}

export function cardsInEntries(doc: SearchEntryResults): CardUsingDefinition[] {
  let titles = new Map<string, string | undefined>();
  for (let resource of doc.included ?? []) {
    if (resource.type === 'card' && resource.id) {
      let title = (resource.attributes as { cardTitle?: unknown } | undefined)
        ?.cardTitle;
      titles.set(
        resource.id,
        typeof title === 'string' && title ? title : undefined,
      );
    }
  }
  let cards: CardUsingDefinition[] = [];
  for (let entry of doc.data) {
    let item = entry.relationships?.item?.data;
    if (item?.type === 'card') {
      cards.push({
        id: item.id,
        title: titles.get(item.id) ?? 'Untitled card',
      });
    }
  }
  return cards;
}
