import {
  facetFieldSpecsOf,
  isResolvedCodeRef,
  SEARCH_TEXT_KEY,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
} from '@cardstack/runtime-common';

// A search doc as the render stamps it for a card of `definition`'s type: its
// declared facet fields in `_searchText.facets` (facet-declarations.ts), which
// the index writer turns into the card's facet table rows. Tests that write
// index rows straight from search data, rather than rendering a card, stamp
// them with this so facets can count them.
export async function withFacetFields(
  searchData: Record<string, unknown>,
  definition: Definition,
  lookup: DefinitionLookup | ((ref: CodeRef) => Promise<Definition>),
): Promise<Record<string, unknown>> {
  let lookupDefinition = async (ref: CodeRef) => {
    if (!isResolvedCodeRef(ref)) {
      return undefined;
    }
    try {
      return typeof lookup === 'function'
        ? await lookup(ref)
        : await lookup.lookupDefinition(ref);
    } catch {
      return undefined;
    }
  };
  let facets = await facetFieldSpecsOf(definition, lookupDefinition);
  if (Object.keys(facets).length === 0) {
    return searchData;
  }
  let existing = (searchData[SEARCH_TEXT_KEY] ?? {}) as Record<string, unknown>;
  return { ...searchData, [SEARCH_TEXT_KEY]: { ...existing, facets } };
}
