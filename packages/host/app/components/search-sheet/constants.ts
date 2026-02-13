import {
  Grid3x3 as GridViewIcon,
  Rows4 as StripViewIcon,
} from '@cardstack/boxel-ui/icons';

import { baseRealm, type Sort } from '@cardstack/runtime-common';

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

/** Initial display limit for sections when not focused */
export const SECTION_DISPLAY_LIMIT_UNFOCUSED = 5;

/** Initial display limit for sections when focused */
export const SECTION_DISPLAY_LIMIT_FOCUSED = 100;

/** Increment when user clicks "show more" */
export const SECTION_SHOW_MORE_INCREMENT = 5;

/**
 * Host-local SORT_OPTIONS compatible with realm server query expectations.
 * Aligned with SORT_OPTIONS in packages/base/components/cards-grid-layout.gts.
 */
export const SORT_OPTIONS: SortOption[] = [
  {
    displayName: 'A-Z',
    sort: [
      {
        on: {
          module: `${baseRealm.url}card-api`,
          name: 'CardDef',
        },
        by: 'cardTitle',
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
