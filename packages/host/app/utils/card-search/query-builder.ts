import type {
  CodeRef,
  Filter,
  Query,
  ResolvedCodeRef,
  SearchEntryScope,
} from '@cardstack/runtime-common';
import {
  baseCardRef,
  baseFieldRef,
  baseFileRef,
  baseRef,
  codeRefFromInternalKey,
  excludeCardInstanceFileRows,
  getTypeRefsFromFilter,
  isAnyFilter,
  isCardTypeFilter,
  isEveryFilter,
  isNotFilter,
  isResolvedCodeRef,
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
// When a subtype is picked from the type filter, the base filter's (parent)
// type condition is redundant — the picked subtype's `types` already contains
// the parent — so dropping it keeps the query minimal. (Type conditions now
// compose as an intersection via self-contained membership predicates, so
// keeping both would also be correct; this is a simplification, not a fix.)
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

// OR-combine full-text markdown search with a `_title` substring match so
// short prefixes (e.g. "ma" → "mango", "mark") still find results by title
// while longer/natural-language queries tap markdown content via `matches`.
// `_title` is the synthetic key stamped on both card and file rows (a card's
// title, a file's name), so the term matches files by name too.
function buildSearchTermFilter(searchTerm: string): Filter {
  return {
    any: [{ matches: searchTerm }, { contains: { _title: searchTerm } }],
  };
}

// Search spans card and file rows in one query. Kind selection is a wire-level
// concern now: a `opts.cardsOnly` caller sends `scope: 'cards'` (see
// `searchScopeForOptions`), which pins `boxel_index.type` to instance rows
// server-side — no filter anchor needed, and immune to a stray file-type filter
// (which just yields no results rather than leaking files). The mixed sheet
// (no `cardsOnly`, `scope: 'all'`) still discriminates the one case scope
// can't: dropping a card's dual-indexed `.json` file row so the card shows
// once. See `scopeFilters`.
export interface BuildQueryOptions {
  cardsOnly?: boolean;
}

// The wire scope for a set of build options. cardsOnly pins card-instance
// rows; anything else is the mixed cards + files search.
export function searchScopeForOptions(
  opts: BuildQueryOptions | undefined,
): SearchEntryScope {
  return opts?.cardsOnly ? 'cards' : 'all';
}

// The root refs span kinds rather than narrowing to one — BaseDef is the
// common ancestor of every row, and CardDef/FieldDef/FileDef are each kind's
// own root (see `getRootTypeKeys` in type-filter.ts for the picker-side
// analogue). A base filter built from them (e.g. the search sheet's
// `{ type: baseRef }`) matches a card's dual-indexed `.json` file row too, so
// it must not suppress the mixed-scope dedup the way a genuinely narrowing
// type ref does.
const ROOT_TYPE_REFS: ResolvedCodeRef[] = [
  baseRef,
  baseCardRef,
  baseFieldRef,
  baseFileRef,
];

function isRootTypeRef(ref: CodeRef): boolean {
  return (
    isResolvedCodeRef(ref) &&
    ROOT_TYPE_REFS.some(
      (root) => root.module === ref.module && root.name === ref.name,
    )
  );
}

function hasNarrowingPositiveTypeRef(filter: Filter | undefined): boolean {
  if (!filter) {
    return false;
  }
  return (
    getTypeRefsFromFilter(filter)?.some(
      (r) => !r.negated && !isRootTypeRef(r.ref),
    ) ?? false
  );
}

function scopeFilters(
  filters: Filter[],
  opts: BuildQueryOptions | undefined,
  hasNarrowingType: boolean,
): Filter[] {
  // cardsOnly is enforced by `scope: 'cards'` on the wire, so nothing to add.
  if (opts?.cardsOnly) {
    return filters;
  }
  // Mixed (`scope: 'all'`) sheet: drop a card's dual-indexed `.json` file row so
  // the card shows once (via its instance row). Skipped when the filter already
  // carries a kind-narrowing positive type ref — a picked card type matches only
  // instance rows (no dupe to drop), and a picked file type must stay free to
  // surface a `.json` file row that legitimately matches it. Root refs
  // (BaseDef/CardDef/FieldDef/FileDef) don't count: they span kinds, so the
  // dedup is still needed (see `hasNarrowingPositiveTypeRef`).
  if (hasNarrowingType) {
    return filters;
  }
  return [...filters, excludeCardInstanceFileRows()];
}

export function buildSearchQuery(
  searchKey: string,
  activeSort: SortOption,
  baseFilter?: Filter,
  selectedTypeIds?: string[],
  opts?: BuildQueryOptions,
): Query {
  const typeFilter = buildTypeFilter(selectedTypeIds);
  const searchTerm = searchKey?.trim() || undefined;
  let filters: Filter[];
  if (baseFilter) {
    // When typeFilter is present, strip the baseFilter's (parent) type
    // constraint as redundant — the picked subtype already implies it. Safe
    // because the type picker only offers subtypes of the baseFilter type.
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
  filters = scopeFilters(
    filters,
    opts,
    Boolean(typeFilter) || hasNarrowingPositiveTypeRef(baseFilter),
  );
  return {
    filter: filters.length === 1 ? filters[0] : { every: filters },
    sort: activeSort.sort,
  };
}

// Narrower query for the Recents section. Matches the pre-prerendered
// client-side behavior where a search term filtered recents only by
// title substring — unlike the realm search which also runs
// full-text `matches` on markdown. Using `matches` here picks up
// linked-card content (e.g. Fadhlan's card markdown includes its
// linked Mango pet, so "man" matches via "mango"), producing false
// positives the previous UX never showed.
//
// Recents are always cards (their URLs are card `.json`s, applied by the
// caller through `cardUrls`), but the same URL also names the card's
// dual-indexed file row — so the mixed/cards-only scoping here is what keeps
// each recent from surfacing twice.
export function buildRecentsQuery(
  searchTerm: string | undefined,
  activeSort: SortOption,
  baseFilter?: Filter,
  selectedTypeIds?: string[],
  opts?: BuildQueryOptions,
): Query {
  const typeFilter = buildTypeFilter(selectedTypeIds);
  const term = searchTerm?.trim() || undefined;
  const termFilter: Filter | undefined = term
    ? { contains: { _title: term } }
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
  filters = scopeFilters(
    filters,
    opts,
    Boolean(typeFilter) || hasNarrowingPositiveTypeRef(baseFilter),
  );
  return {
    filter: filters.length === 1 ? filters[0] : { every: filters },
    sort: activeSort.sort,
  };
}
