import type {
  CodeRef,
  Filter,
  Query,
  ResolvedCodeRef,
  TypeRefResult,
} from '@cardstack/runtime-common';
import {
  getTypeRefsFromFilter,
  identifyCard,
  isBaseDef,
  isResolvedCodeRef,
  specRef,
} from '@cardstack/runtime-common';

import type { SortOption } from './constants';
import type { CardDef } from '@cardstack/base/card-api';

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

export function buildSearchQuery(
  searchKey: string,
  activeSort: SortOption,
  baseFilter?: Filter,
): Query {
  if (baseFilter) {
    const searchTerm = searchKey?.trim() || undefined;
    return {
      filter: {
        every: [
          baseFilter,
          ...(searchTerm ? [{ contains: { cardTitle: searchTerm } }] : []),
        ],
      },
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
        ...(searchTerm ? [{ contains: { cardTitle: searchTerm } }] : []),
      ],
    },
    sort: activeSort.sort,
  };
}
