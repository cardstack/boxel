import type {
  CodeRef,
  Filter,
  Query,
  ResolvedCodeRef,
  TypeRefResult,
} from '@cardstack/runtime-common';
import {
  codeRefFromInternalKey,
  getTypeRefsFromFilter,
  identifyCard,
  isAnyFilter,
  isBaseDef,
  isCardTypeFilter,
  isEveryFilter,
  isNotFilter,
  isResolvedCodeRef,
  specRef,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type { SortOption } from './constants';

export interface NewCardArgs {
  ref: CodeRef;
  relativeTo: string | undefined;
  realmURL: string;
}

export function getCodeRefFromSearchKey(
  searchKey: string,
): ResolvedCodeRef | undefined {
  if (searchKey.startsWith('carddef:')) {
    let internalKey = searchKey.substring('carddef:'.length);
    let parts = internalKey.split('/');
    let name = parts.pop()!;
    let module = parts.join('/');
    return { module, name };
  }
  return undefined;
}

export function removeFileExtension(cardId: string | undefined) {
  return cardId?.replace(/\.[^/.]+$/, '');
}

export function shouldSkipSearchQuery(
  searchKey: string,
  baseFilter?: Filter,
): boolean {
  if (baseFilter) {
    return isURLSearchKey(searchKey);
  }
  return isSearchKeyEmpty(searchKey) || isURLSearchKey(searchKey);
}

function isSearchKeyEmpty(searchKey: string): boolean {
  return (searchKey?.trim() ?? '') === '';
}

function isURLSearchKey(searchKey: string): boolean {
  const maybeType = getCodeRefFromSearchKey(searchKey);
  if (maybeType) {
    return false;
  }
  try {
    new URL(searchKey);
    return true;
  } catch (_e) {
    return false;
  }
}

export function cardMatchesTypeRef(card: CardDef, typeRef: CodeRef): boolean {
  if (!isResolvedCodeRef(typeRef)) {
    return false;
  }
  let cls: unknown = card.constructor;
  while (cls && isBaseDef(cls)) {
    const ref = identifyCard(cls);
    if (
      ref &&
      isResolvedCodeRef(ref) &&
      ref.module === typeRef.module &&
      ref.name === typeRef.name
    ) {
      return true;
    }
    cls = Reflect.getPrototypeOf(cls as object);
  }
  return false;
}

export function getFilterTypeRefs(
  baseFilter: Filter | undefined,
  searchKey: string,
): TypeRefResult[] | undefined {
  if (baseFilter) {
    return getTypeRefsFromFilter(baseFilter);
  }
  const ref = getCodeRefFromSearchKey(searchKey);
  return ref ? [{ ref, negated: false }] : undefined;
}

export function filterCardsByTypeRefs(
  cards: CardDef[],
  typeRefs: TypeRefResult[] | undefined,
): CardDef[] {
  if (!typeRefs) {
    return cards;
  }
  const positiveRefs = typeRefs.filter((r) => !r.negated).map((r) => r.ref);
  const negatedRefs = typeRefs.filter((r) => r.negated).map((r) => r.ref);
  let filtered = cards;
  if (positiveRefs.length > 0) {
    filtered = filtered.filter((c) =>
      positiveRefs.some((ref) => cardMatchesTypeRef(c, ref)),
    );
  }
  if (negatedRefs.length > 0) {
    filtered = filtered.filter(
      (c) => !negatedRefs.some((ref) => cardMatchesTypeRef(c, ref)),
    );
  }
  return filtered;
}

export function getSearchTerm(searchKey: string): string | undefined {
  if (isSearchKeyEmpty(searchKey) || isURLSearchKey(searchKey)) {
    return undefined;
  }
  const type = getCodeRefFromSearchKey(searchKey);
  return type ? undefined : searchKey;
}

// Removes CardTypeFilter nodes from a filter tree.
// Returns undefined if the entire filter was type-only.
// Used to avoid combining two type conditions in an `every` clause,
// which produces impossible SQL (the query engine shares one cross-join alias
// for all tableValuedEach('types') references).
function stripTypeFromFilter(filter: Filter): Filter | undefined {
  if (isCardTypeFilter(filter) && Object.keys(filter).length === 1) {
    return undefined;
  }
  if (isEveryFilter(filter)) {
    const children = filter.every
      .map((f) => stripTypeFromFilter(f))
      .filter((f): f is Filter => f !== undefined);
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { every: children };
  }
  if (isAnyFilter(filter)) {
    const children = filter.any
      .map((f) => stripTypeFromFilter(f))
      .filter((f): f is Filter => f !== undefined);
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { any: children };
  }
  if (isNotFilter(filter)) {
    const inner = stripTypeFromFilter(filter.not);
    if (!inner) return undefined;
    return { not: inner };
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

export function buildSearchQuery(
  searchKey: string,
  activeSort: SortOption,
  baseFilter?: Filter,
  selectedTypeIds?: string[],
): Query {
  const typeFilter = buildTypeFilter(selectedTypeIds);
  if (baseFilter) {
    const searchTerm = searchKey?.trim() || undefined;
    // When typeFilter is present, strip the baseFilter's type constraint
    // to avoid SQL conflict where two type conditions share one cross-join alias.
    // This is safe because the type picker only offers subtypes of the baseFilter type.
    const effectiveBaseFilter = typeFilter
      ? stripTypeFromFilter(baseFilter)
      : baseFilter;
    const filters: Filter[] = [
      ...(effectiveBaseFilter ? [effectiveBaseFilter] : []),
      ...(typeFilter ? [typeFilter] : []),
      ...(searchTerm ? [{ contains: { cardTitle: searchTerm } }] : []),
    ];
    return {
      filter: filters.length === 1 ? filters[0] : { every: filters },
      sort: activeSort.sort,
    };
  }
  const type = getCodeRefFromSearchKey(searchKey);
  const searchTerm = !type ? searchKey : undefined;
  return {
    filter: {
      every: [
        {
          ...(type ? { type } : { not: { type: specRef } }),
        },
        ...(typeFilter ? [typeFilter] : []),
        ...(searchTerm ? [{ contains: { cardTitle: searchTerm } }] : []),
      ],
    },
    sort: activeSort.sort,
  };
}
