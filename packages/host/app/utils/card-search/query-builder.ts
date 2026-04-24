import type {
  CodeRef,
  Filter,
  Query,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  codeRefFromInternalKey,
  isAnyFilter,
  isCardTypeFilter,
  isEveryFilter,
  isNotFilter,
  specRef,
} from '@cardstack/runtime-common';

import type { SortOption } from '@cardstack/host/components/card-search/constants';

import { isSearchKeyEmpty, isURLSearchKey } from './url';

export function shouldSkipSearchQuery(
  searchKey: string,
  baseFilter?: Filter,
): boolean {
  if (baseFilter) {
    return isURLSearchKey(searchKey);
  }
  return isSearchKeyEmpty(searchKey) || isURLSearchKey(searchKey);
}

// Removes CardTypeFilter nodes from a filter tree.
// Returns undefined if the entire filter was type-only.
// Used to avoid combining two type conditions in an `every` clause,
// which produces impossible SQL (the query engine shares one cross-join alias
// for all tableValuedEach('types') references).
function stripTypeFromFilter(filter: Filter): Filter | undefined {
  // Preserve the `on` property (TypedFilter) so field-scoped filters
  // like {on: specRef, every: [{eq: {isCard: true}}]} keep their type context.
  const on =
    'on' in filter ? (filter as Filter & { on: CodeRef }).on : undefined;

  if (isCardTypeFilter(filter) && Object.keys(filter).length === 1) {
    return undefined;
  }
  if (isEveryFilter(filter)) {
    const children = filter.every
      .map((f) => stripTypeFromFilter(f))
      .filter((f): f is Filter => f !== undefined);
    if (children.length === 0) return undefined;
    if (children.length === 1) return on ? { ...children[0], on } : children[0];
    return on ? { every: children, on } : { every: children };
  }
  if (isAnyFilter(filter)) {
    const children = filter.any
      .map((f) => stripTypeFromFilter(f))
      .filter((f): f is Filter => f !== undefined);
    if (children.length === 0) return undefined;
    if (children.length === 1) return on ? { ...children[0], on } : children[0];
    return on ? { any: children, on } : { any: children };
  }
  if (isNotFilter(filter)) {
    const inner = stripTypeFromFilter(filter.not);
    if (!inner) return undefined;
    return on ? { not: inner, on } : { not: inner };
  }
  return filter;
}

function buildTypeFilter(
  selectedTypeIds: string[] | undefined,
): Filter | undefined {
  if (!selectedTypeIds || selectedTypeIds.length === 0) {
    return undefined;
  }
  const codeRefs = selectedTypeIds
    .map((id) => codeRefFromInternalKey(id))
    .filter((ref): ref is ResolvedCodeRef => ref !== undefined);

  if (codeRefs.length === 0) {
    return undefined;
  }
  if (codeRefs.length === 1) {
    return { type: codeRefs[0] };
  }
  return { any: codeRefs.map((ref) => ({ type: ref })) };
}

// OR-combine full-text markdown search with a cardTitle substring match so
// short prefixes (e.g. "ma" → "mango", "mark") still find cards by title
// while longer/natural-language queries tap markdown content via `matches`.
function buildSearchTermFilter(searchTerm: string): Filter {
  return {
    any: [{ matches: searchTerm }, { contains: { cardTitle: searchTerm } }],
  };
}

export function buildSearchQuery(
  searchKey: string,
  activeSort: SortOption,
  baseFilter?: Filter,
  selectedTypeIds?: string[],
): Query {
  const typeFilter = buildTypeFilter(selectedTypeIds);
  const searchTerm = searchKey?.trim() || undefined;
  let filters: Filter[];
  if (baseFilter) {
    // When typeFilter is present, strip the baseFilter's type constraint
    // to avoid SQL conflict where two type conditions share one cross-join alias.
    // This is safe because the type picker only offers subtypes of the baseFilter type.
    const effectiveBaseFilter = typeFilter
      ? stripTypeFromFilter(baseFilter)
      : baseFilter;
    filters = [
      ...(effectiveBaseFilter ? [effectiveBaseFilter] : []),
      ...(typeFilter ? [typeFilter] : []),
      ...(searchTerm ? [buildSearchTermFilter(searchTerm)] : []),
    ];
  } else {
    filters = [
      { not: { type: specRef } },
      ...(typeFilter ? [typeFilter] : []),
      ...(searchTerm ? [buildSearchTermFilter(searchTerm)] : []),
    ];
  }
  return {
    filter: filters.length === 1 ? filters[0] : { every: filters },
    sort: activeSort.sort,
  };
}

// Narrower query for the Recents section. Matches the pre-prerendered
// client-side behavior where a search term filtered recents only by
// cardTitle substring — unlike the realm search which also runs
// full-text `matches` on markdown. Using `matches` here picks up
// linked-card content (e.g. Fadhlan's card markdown includes its
// linked Mango pet, so "man" matches via "mango"), producing false
// positives the previous UX never showed.
export function buildRecentsQuery(
  searchTerm: string | undefined,
  activeSort: SortOption,
  baseFilter?: Filter,
  selectedTypeIds?: string[],
): Query {
  const typeFilter = buildTypeFilter(selectedTypeIds);
  const term = searchTerm?.trim() || undefined;
  const termFilter: Filter | undefined = term
    ? { contains: { cardTitle: term } }
    : undefined;
  let filters: Filter[];
  if (baseFilter) {
    const effectiveBaseFilter = typeFilter
      ? stripTypeFromFilter(baseFilter)
      : baseFilter;
    filters = [
      ...(effectiveBaseFilter ? [effectiveBaseFilter] : []),
      ...(typeFilter ? [typeFilter] : []),
      ...(termFilter ? [termFilter] : []),
    ];
  } else {
    filters = [
      { not: { type: specRef } },
      ...(typeFilter ? [typeFilter] : []),
      ...(termFilter ? [termFilter] : []),
    ];
  }
  return {
    filter: filters.length === 1 ? filters[0] : { every: filters },
    sort: activeSort.sort,
  };
}
