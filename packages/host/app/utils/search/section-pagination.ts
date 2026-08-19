import { tracked } from '@glimmer/tracking';

import {
  SECTION_DISPLAY_LIMIT_FOCUSED,
  SECTION_DISPLAY_LIMIT_UNFOCUSED,
  SECTION_SHOW_MORE_INCREMENT,
} from '@cardstack/host/components/search/constants';

/**
 * Manages pagination and focus state for search result sections.
 *
 * Tracks which section is focused ("Show Only"), how many cards
 * are displayed per section, and handles "Show More" increments.
 */
export class SectionPagination {
  @tracked focusedSection: string | null;
  @tracked displayedCounts: Record<string, number> = {};

  constructor(initialFocusedSection?: string | null) {
    this.focusedSection = initialFocusedSection ?? null;
  }

  getDisplayedCount = (sectionId: string, totalCount: number): number => {
    const isFocused = this.focusedSection === sectionId;
    const initialLimit = isFocused
      ? SECTION_DISPLAY_LIMIT_FOCUSED
      : SECTION_DISPLAY_LIMIT_UNFOCUSED;
    const current = this.displayedCounts[sectionId] ?? initialLimit;
    return Math.min(current, totalCount);
  };

  showMore(sectionId: string, totalCount: number): void {
    const current = this.getDisplayedCount(sectionId, totalCount);
    const next = Math.min(current + SECTION_SHOW_MORE_INCREMENT, totalCount);
    this.displayedCounts = {
      ...this.displayedCounts,
      [sectionId]: next,
    };
  }

  focus(sectionId: string | null): void {
    this.focusedSection = sectionId;
    if (sectionId) {
      const current = this.displayedCounts[sectionId] ?? 0;
      if (current < SECTION_DISPLAY_LIMIT_FOCUSED) {
        this.displayedCounts = {
          ...this.displayedCounts,
          [sectionId]: SECTION_DISPLAY_LIMIT_FOCUSED,
        };
      }
    }
  }

  isCollapsed(sectionId: string): boolean {
    return !!this.focusedSection && this.focusedSection !== sectionId;
  }
}
