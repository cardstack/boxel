import {
  Grid3x3 as GridViewIcon,
  Rows4 as StripViewIcon,
} from '@cardstack/boxel-ui/icons';

import { baseRRI, type Sort } from '@cardstack/runtime-common';

export interface ViewOption {
  id: string;
  icon: typeof GridViewIcon;
}

export interface SortOption {
  displayName: string;
  sort: Sort;
}

/**
 * Host-local VIEW_OPTIONS for search sheet. Grid and strip only (no card view).
 * Aligned with cards-grid-layout but host cannot statically import from base.
 */
export const VIEW_OPTIONS: ViewOption[] = [
  { id: 'grid', icon: GridViewIcon },
  { id: 'strip', icon: StripViewIcon },
];

// 'mini' is an internal-only view id that opt-in consumers (e.g.
// MiniCardChooser) request via @variant='mini'. It is deliberately
// not in VIEW_OPTIONS so the user-facing view picker stays grid/strip.
export type SectionViewOption = 'grid' | 'strip' | 'mini';

/** Initial display limit for sections when not focused */
export const SECTION_DISPLAY_LIMIT_UNFOCUSED = 5;

/** Initial display limit for sections when focused */
export const SECTION_DISPLAY_LIMIT_FOCUSED = 100;

/** Increment when user clicks "show more" */
export const SECTION_SHOW_MORE_INCREMENT = 5;

/**
 * Host-local SORT_OPTIONS compatible with realm server query expectations.
 * Aligned with SORT_OPTIONS in packages/base/components/cards-grid-layout.gts.
 *
 * The `sort` field is embedded in the search Query sent to the realm
 * server; realm and recents sections both apply it server-side via
 * prerendered search. URL card lookup has no sort (single card).
 */
export const SORT_OPTIONS: SortOption[] = [
  {
    displayName: 'A-Z',
    sort: [
      {
        on: {
          module: baseRRI('card-api'),
          name: 'CardDef',
        },
        // The sheet is mixed cards + files, so sort on the synthetic `_title`
        // key that both row types carry (a card's title — mirrored from
        // `cardTitle` at index time — and a file's name). Sorting on
        // `cardTitle` alone would leave file rows NULL and sink them all below
        // the cards under NULLS LAST.
        by: '_title',
        direction: 'asc',
      },
    ],
  },
  {
    displayName: 'Last Updated',
    sort: [
      {
        by: 'lastModified',
        direction: 'desc',
      },
    ],
  },
  {
    displayName: 'Date Created',
    sort: [
      {
        by: 'createdAt',
        direction: 'desc',
      },
    ],
  },
];
