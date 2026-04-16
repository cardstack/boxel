import type { Filter, ResolvedCodeRef } from '@cardstack/runtime-common';

import type { SortOption } from '@cardstack/host/components/card-search/constants';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import {
  cardMatchesTypeRef,
  filterCardsByTypeRefs,
  getFilterTypeRefs,
} from './type-filter';

/**
 * Filters recent cards by realm URLs and base filter type constraints.
 */
export function filterRecentCards(
  cards: CardDef[],
  realmURLs: string[],
  baseFilter?: Filter,
): CardDef[] {
  const realmFiltered = cards.filter(
    (c) => c.id && realmURLs.some((url) => c.id.startsWith(url)),
  );
  const typeRefs = getFilterTypeRefs(baseFilter);
  return filterCardsByTypeRefs(realmFiltered, typeRefs);
}

/**
 * Further filters and sorts recent cards based on:
 * 1. Type picker selection (unless skipTypeFiltering)
 * 2. Search term matching on card title
 * 3. Active sort option (A-Z, Last Updated, Date Created)
 *
 * In compact mode, skips search term filtering and sorting.
 */
export function sortAndFilterRecentCards(
  cards: CardDef[],
  opts: {
    selectedTypes: ResolvedCodeRef[];
    skipTypeFiltering: boolean;
    searchTerm: string | undefined;
    activeSort: SortOption;
    isCompact: boolean;
  },
): CardDef[] {
  let filtered = [...cards];

  // Apply type picker filter.
  // Skip when baseFilter has a non-root type — the server already
  // constrains results via the adoption chain, and recent cards are
  // pre-filtered by filterCardsByTypeRefs which handles subtypes.
  if (!opts.skipTypeFiltering && opts.selectedTypes.length > 0) {
    filtered = filtered.filter((card) =>
      opts.selectedTypes.some((ref) => cardMatchesTypeRef(card, ref)),
    );
  }

  if (opts.isCompact) {
    return filtered;
  }

  // Apply search term filter
  if (opts.searchTerm) {
    const lowerTerm = opts.searchTerm.toLowerCase();
    filtered = filtered.filter((c) =>
      (c.cardTitle ?? '').toLowerCase().includes(lowerTerm),
    );
  }

  // Sort
  return sortCards(filtered, opts.activeSort);
}

function sortCards(cards: CardDef[], sortOption: SortOption): CardDef[] {
  const displayName = sortOption.displayName;
  return [...cards].sort((a, b) => {
    if (displayName === 'A-Z') {
      return (a.cardTitle ?? '').localeCompare(b.cardTitle ?? '');
    }
    if (displayName === 'Last Updated') {
      const aVal =
        'lastModified' in a
          ? ((a as Record<string, unknown>).lastModified as number)
          : 0;
      const bVal =
        'lastModified' in b
          ? ((b as Record<string, unknown>).lastModified as number)
          : 0;
      return bVal - aVal;
    }
    if (displayName === 'Date Created') {
      const aVal =
        'createdAt' in a
          ? ((a as Record<string, unknown>).createdAt as number)
          : 0;
      const bVal =
        'createdAt' in b
          ? ((b as Record<string, unknown>).createdAt as number)
          : 0;
      return bVal - aVal;
    }
    return 0;
  });
}
