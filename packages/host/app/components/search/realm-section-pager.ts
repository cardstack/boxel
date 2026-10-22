import { isEqual } from 'lodash-es';

import type {
  RenderableSearchEntryLike,
  SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import {
  getRenderableSearchEntries,
  type RenderableSearchEntries,
} from '@cardstack/host/resources/renderable-search-entries';

import type { RealmSection } from '@cardstack/host/utils/search/sections';

import { SECTION_DISPLAY_LIMIT_FOCUSED } from './constants';

export interface RealmSectionPagerInputs {
  section: RealmSection;
  // The main search's query, re-issued scoped to the section's realm.
  pageQuery: SearchEntryWireQuery | undefined;
  // How many rows the section currently displays.
  limit: number;
}

function withoutPage(
  query: SearchEntryWireQuery | undefined,
): Omit<SearchEntryWireQuery, 'page'> | undefined {
  if (!query) {
    return undefined;
  }
  let { page: _page, ...rest } = query;
  return rest;
}

// Loads a realm section's rows past the first page the main search returned,
// by re-issuing the main query scoped to that realm and sized to cover what
// the section displays. The section renders `cards`, and Select All reads the
// same `cards`, so a selectable row is always a selectable-all row.
export class RealmSectionPager {
  #results: RenderableSearchEntries;

  constructor(
    owner: object,
    private getInputs: () => RealmSectionPagerInputs | undefined,
  ) {
    this.#results = getRenderableSearchEntries(
      owner,
      () => this.query,
      () => 'none',
    );
  }

  // Grows a whole first page at a time, so crossing each boundary costs one
  // fetch rather than one per "Show more". Idle until the section displays
  // more rows than the main search returned.
  private get query(): SearchEntryWireQuery | undefined {
    let inputs = this.getInputs();
    if (!inputs?.pageQuery) {
      return undefined;
    }
    let { section, pageQuery, limit } = inputs;
    let pageSize = pageQuery.page?.size ?? SECTION_DISPLAY_LIMIT_FOCUSED;
    if (limit <= section.cards.length || limit <= pageSize) {
      return undefined;
    }
    return {
      ...pageQuery,
      realms: [section.realmUrl],
      page: { size: Math.ceil(limit / pageSize) * pageSize },
    };
  }

  // The extended rows count only while they belong to the current query up to
  // page size: a boundary-crossing fetch keeps showing the smaller extended
  // set, while a changed search falls back to the main search's rows rather
  // than rendering the previous search's.
  get cards(): RenderableSearchEntryLike[] {
    let section = this.getInputs()?.section;
    if (!section) {
      return [];
    }
    let query = this.query;
    if (
      !query ||
      !isEqual(withoutPage(this.#results.entriesQuery), withoutPage(query))
    ) {
      return section.cards;
    }
    let extended = this.#results.entries;
    return extended.length > section.cards.length ? extended : section.cards;
  }

  private get isShort(): boolean {
    let inputs = this.getInputs();
    return !!inputs && this.cards.length < inputs.limit;
  }

  get isLoading(): boolean {
    return !!this.query && this.#results.isLoading && this.isShort;
  }

  get failed(): boolean {
    return (
      !!this.query &&
      !this.#results.isLoading &&
      (this.#results.errors?.length ?? 0) > 0 &&
      this.isShort
    );
  }

  retry(): void {
    this.#results.retry();
  }
}
