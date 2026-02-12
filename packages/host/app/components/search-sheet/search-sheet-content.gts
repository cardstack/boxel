import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { debounce } from 'lodash';
import { trackedFunction } from 'reactiveweb/function';

import { eq } from '@cardstack/boxel-ui/helpers';

import { isCardInstance, specRef } from '@cardstack/runtime-common';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentCards from '@cardstack/host/services/recent-cards-service';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import PrerenderedCardSearch from '../prerendered-card-search';

import {
  SECTION_DISPLAY_LIMIT_FOCUSED,
  SECTION_DISPLAY_LIMIT_UNFOCUSED,
  SECTION_SHOW_MORE_INCREMENT,
  SORT_OPTIONS,
  VIEW_OPTIONS,
  type SortOption,
} from './constants';
import SearchResultHeader from './search-result-header';

import SearchResultSection from './search-result-section';
import { getCodeRefFromSearchKey } from './utils';

import type { PrerenderedCard } from '../prerendered-card-search';

export interface RealmSection {
  sid: string;
  type: 'realm';
  realmUrl: string;
  realmInfo: { name: string; iconURL?: string };
  cards: PrerenderedCard[];
  totalCount: number;
}

export interface RecentsSection {
  sid: string;
  type: 'recents';
  cards: CardDef[];
  totalCount: number;
}

export interface UrlSection {
  sid: string;
  type: 'url';
  card: CardDef;
  realmInfo: { name: string; iconURL?: string };
}

export type SearchSheetSection = RealmSection | RecentsSection | UrlSection;

interface Signature {
  Element: HTMLElement;
  Args: {
    searchKey: string;
    selectedRealmURLs: string[];
    isCompact: boolean;
    handleCardSelect: (cardId: string) => void;
    onFetchCardByUrlError?: (error: Error) => void;
  };
  Blocks: {};
}

export default class SearchSheetContent extends Component<Signature> {
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;
  @service declare recentCardsService: RecentCards;
  @service declare store: StoreService;

  @tracked activeViewId = 'grid';
  @tracked activeSort: SortOption = SORT_OPTIONS[0];
  @tracked isFetchingQuery = false;
  @tracked totalQueryResults: number = 0;
  /** Section id when focused: 'realm:<url>' or 'recents'. Null = no focus */
  @tracked focusedSection: string | null = null;
  @tracked displayedCountBySection: Record<string, number> = {};
  @tracked resultCountByRealm: Record<string, number> = {};

  recentCardCollection = getCardCollection(
    this,
    () => this.recentCardsService.recentCardIds,
  );

  private get isSearchKeyEmpty() {
    return (this.args.searchKey?.trim() ?? '') === '';
  }

  private get searchKeyIsURL() {
    let maybeType = getCodeRefFromSearchKey(this.args.searchKey);
    if (maybeType) {
      return false;
    }
    try {
      new URL(this.args.searchKey);
      return true;
    } catch (_e) {
      return false;
    }
  }

  private get searchKeyAsURL() {
    if (!this.searchKeyIsURL) {
      return undefined;
    }
    let cardURL = this.args.searchKey;

    let maybeIndexCardURL = this.realmServer.availableRealmURLs.find(
      (u) => u === cardURL + '/',
    );
    return maybeIndexCardURL ?? cardURL;
  }

  // note that this is a card that is eligible for garbage collection
  // and is meant for immediate consumption. it's not safe to pass this
  // as state for another component.
  private fetchCardByUrl = trackedFunction(this, async () => {
    if (!this.searchKeyAsURL) {
      return;
    }
    let card = await this.store.get(this.searchKeyAsURL);
    if (!card) {
      this.args.onFetchCardByUrlError?.(
        new Error(`Card not found at ${this.searchKeyAsURL}`),
      );
    }
    return {
      card,
    };
  });

  private get fetchCardByUrlResult() {
    let value = this.fetchCardByUrl.value;
    if (value) {
      if (value.card) {
        return { card: value.card };
      } else {
        return { card: null };
      }
    }

    return undefined;
  }

  private get resolvedCard() {
    const result = this.fetchCardByUrlResult;
    const card = result?.card;
    return card && isCardInstance(card) ? card : null;
  }

  private get realms() {
    const urls =
      this.args.selectedRealmURLs.length > 0
        ? this.args.selectedRealmURLs
        : this.realmServer.availableRealmURLs;
    return urls ?? [];
  }

  private get query() {
    const { searchKey } = this.args;
    const type = getCodeRefFromSearchKey(searchKey);
    const searchTerm = !type ? searchKey : undefined;
    return {
      filter: {
        every: [
          {
            ...(type
              ? { type }
              : {
                  not: {
                    type: specRef,
                  },
                }),
          },
          ...(searchTerm
            ? [
                {
                  contains: {
                    cardTitle: searchTerm,
                  },
                },
              ]
            : []),
        ],
      },
      sort: this.activeSort.sort,
    };
  }

  private get summaryText(): string {
    if (this.isFetchingQuery || this.fetchCardByUrl.isPending) {
      return 'Searching…';
    }

    let total = this.totalQueryResults;
    let realms = this.realms;
    if (this.args.isCompact) {
      return '';
    }
    if (this.searchKeyIsURL) {
      if (this.resolvedCard) {
        return '1 result from 1 realm';
      }
      return '0 results';
    }
    if (this.focusedSection === 'recents' || this.isSearchKeyEmpty) {
      const count = this.recentCardsService.recentCardIds.length;
      return count === 1 ? '1 in Recent' : `${count} in Recents`;
    }

    if (this.focusedSection != null) {
      if (this.focusedSection.startsWith('realm:')) {
        const realmUrl = this.focusedSection.slice('realm:'.length);
        const realmInfo = this.realm.info(realmUrl);
        const realmName =
          realmInfo?.name ?? this.realmNameFromUrl(realmUrl) ?? realmUrl;
        const realmTotal = this.resultCountByRealm[realmUrl];

        if (typeof realmTotal === 'number') {
          return `${total} result${total === 1 ? '' : 's'} across ${realms.length} realm${realms.length === 1 ? '' : 's'}, ${realmTotal} result${realmTotal === 1 ? '' : 's'} in ${realmName}`;
        }

        // Fallback if we don't yet have per-realm counts
        return `${total} result${total === 1 ? '' : 's'} in ${realmName}`;
      }

      return `${total} result${total === 1 ? '' : 's'} in ${this.focusedSection}`;
    }

    return `${total} result${total === 1 ? '' : 's'} across ${realms.length} realm${realms.length === 1 ? '' : 's'}`;
  }

  private get sortedRecentCards(): CardDef[] {
    const cards = this.recentCardCollection.cards.filter(Boolean) as CardDef[];
    const sortOption = this.activeSort;
    const displayName = sortOption.displayName;
    return [...cards].sort((a, b) => {
      if (displayName === 'A-Z') {
        return (a.cardTitle ?? '').localeCompare(b.cardTitle ?? '');
      }
      if (displayName === 'Last Updated') {
        const aVal = (a as any).lastModified ?? 0;
        const bVal = (b as any).lastModified ?? 0;
        return bVal - aVal;
      }
      if (displayName === 'Date Created') {
        const aVal = (a as any).createdAt ?? 0;
        const bVal = (b as any).createdAt ?? 0;
        return bVal - aVal;
      }
      return 0;
    });
  }

  private get recentCardsSection(): SearchSheetSection {
    return {
      sid: 'recents',
      type: 'recents',
      cards: this.sortedRecentCards,
      totalCount: this.sortedRecentCards.length,
    } as RecentsSection;
  }

  debounceSetQueryResultsMeta = debounce(
    (meta: { page?: { total?: number } }) => {
      // use debounce to prevent excessive re-renders
      this.totalQueryResults = meta.page?.total ?? 0;
      this.isFetchingQuery = false;
    },
    100,
  );

  debounceSetIsFetchingQuery = debounce((isFetching: boolean) => {
    // use debounce to prevent excessive re-renders
    this.isFetchingQuery = isFetching;
  }, 100);

  @action
  onChangeView(id: string) {
    this.activeViewId = id;
  }

  @action
  onChangeSort(option: SortOption) {
    this.activeSort = option;
  }

  @action
  onFocusSection(sectionId: string | null) {
    this.focusedSection = sectionId;
    if (sectionId) {
      const current = this.displayedCountBySection[sectionId] ?? 0;
      const limit = SECTION_DISPLAY_LIMIT_FOCUSED;
      if (current < limit) {
        this.displayedCountBySection = {
          ...this.displayedCountBySection,
          [sectionId]: limit,
        };
      }
    }
  }

  getDisplayedCount = (sectionId: string, totalCount: number): number => {
    const isFocused = this.focusedSection === sectionId;
    const initialLimit = isFocused
      ? SECTION_DISPLAY_LIMIT_FOCUSED
      : SECTION_DISPLAY_LIMIT_UNFOCUSED;
    const current = this.displayedCountBySection[sectionId] ?? initialLimit;
    return Math.min(current, totalCount);
  };

  @action
  onShowMore(sectionId: string, totalCount: number) {
    const current = this.getDisplayedCount(sectionId, totalCount);
    const next = Math.min(current + SECTION_SHOW_MORE_INCREMENT, totalCount);
    this.displayedCountBySection = {
      ...this.displayedCountBySection,
      [sectionId]: next,
    };
  }

  private realmNameFromUrl(realmUrl: string): string {
    try {
      const pathname = new URL(realmUrl).pathname;
      const segments = pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] ?? 'Workspace';
    } catch {
      return 'Workspace';
    }
  }

  private get cardByUrlSection(): SearchSheetSection | undefined {
    if (!this.searchKeyIsURL || !this.resolvedCard) {
      return undefined;
    }
    const card = this.resolvedCard;
    const urlForRealm = urlForRealmLookup(card);
    const realmUrl = this.realmUrlForCard(urlForRealm);
    const realmInfo = realmUrl ? this.realm.info(realmUrl) : null;
    return {
      sid: `url:${card.id}`,
      type: 'url',
      card,
      realmInfo: {
        name: realmInfo?.name ?? this.realmNameFromUrl(realmUrl),
        iconURL: realmInfo?.iconURL ?? undefined,
      },
    } as UrlSection;
  }

  buildCardByQuerySections = (
    cards: { realmUrl: string; url: string }[],
  ): SearchSheetSection[] => {
    const byRealm = new Map<string, typeof cards>();
    for (const card of cards) {
      const list = byRealm.get(card.realmUrl) ?? [];
      list.push(card);
      byRealm.set(card.realmUrl, list);
    }
    const sections: RealmSection[] = [];
    for (const [realmUrl, realmCards] of byRealm) {
      const realmInfo = this.realm.info(realmUrl);
      sections.push({
        sid: `realm:${realmUrl}`,
        type: 'realm',
        realmUrl,
        realmInfo: {
          name: realmInfo?.name ?? this.realmNameFromUrl(realmUrl),
          iconURL: realmInfo?.iconURL ?? undefined,
        },
        cards: realmCards as any,
        totalCount: realmCards.length,
      });
    }

    // Store section for usage in summary text
    const resultCountByRealm: Record<string, number> = {};
    for (const section of sections) {
      if (section.type === 'realm') {
        resultCountByRealm[section.realmUrl] = section.totalCount;
      }
    }
    this.resultCountByRealm = resultCountByRealm;
    return sections;
  };

  private realmUrlForCard(cardIdOrUrl: string): string {
    for (const realm of this.realms) {
      if (cardIdOrUrl.startsWith(realm)) {
        return realm;
      }
    }
    try {
      const url = new URL(cardIdOrUrl);
      return `${url.origin}${url.pathname.split('/').slice(0, -1)?.join('/') ?? ''}/`;
    } catch {
      return '';
    }
  }

  @action
  isSectionCollapsed(sectionId: string): boolean {
    return !!this.focusedSection && this.focusedSection !== sectionId;
  }

  <template>
    <div class='search-sheet-content {{if @isCompact "compact"}}'>
      {{#unless @isCompact}}
        <SearchResultHeader
          @summaryText={{this.summaryText}}
          @viewOptions={{VIEW_OPTIONS}}
          @activeViewId={{this.activeViewId}}
          @activeSort={{this.activeSort}}
          @sortOptions={{SORT_OPTIONS}}
          @onChangeView={{this.onChangeView}}
          @onChangeSort={{this.onChangeSort}}
        />
      {{/unless}}
      {{#if this.searchKeyIsURL}}
        {{! URL path: single card or empty }}
        {{#if this.cardByUrlSection}}
          <SearchResultSection
            @section={{this.cardByUrlSection}}
            @viewOption={{this.activeViewId}}
            @isCompact={{@isCompact}}
            @handleCardSelect={{@handleCardSelect}}
            @isFocused={{eq this.focusedSection this.cardByUrlSection.sid}}
            @isCollapsed={{this.isSectionCollapsed this.cardByUrlSection.sid}}
            @onFocusSection={{this.onFocusSection}}
            @getDisplayedCount={{this.getDisplayedCount}}
            @onShowMore={{this.onShowMore}}
          />
        {{else if this.searchKeyAsURL}}
          <div class='empty-state' data-test-search-sheet-empty>
            No card found at
            {{@searchKey}}
          </div>
        {{/if}}
      {{else if this.isSearchKeyEmpty}}
        {{! empty content }}
      {{else}}
        {{! Query path: PrerenderedCardSearch }}
        <PrerenderedCardSearch
          @query={{this.query}}
          @format='fitted'
          @realms={{this.realms}}
        >
          <:loading>
            {{this.debounceSetIsFetchingQuery true}}
          </:loading>
          <:response as |cards|>
            {{#let (this.buildCardByQuerySections cards) as |sections|}}
              {{#each sections as |section|}}
                <SearchResultSection
                  @section={{section}}
                  @viewOption={{this.activeViewId}}
                  @isCompact={{@isCompact}}
                  @handleCardSelect={{@handleCardSelect}}
                  @isFocused={{eq this.focusedSection section.sid}}
                  @isCollapsed={{this.isSectionCollapsed section.sid}}
                  @onFocusSection={{this.onFocusSection}}
                  @getDisplayedCount={{this.getDisplayedCount}}
                  @onShowMore={{this.onShowMore}}
                />
              {{/each}}
            {{/let}}
          </:response>
          <:meta as |meta|>
            {{this.debounceSetQueryResultsMeta meta}}
          </:meta>
        </PrerenderedCardSearch>
      {{/if}}
      {{#if this.recentCardsSection}}
        <SearchResultSection
          @section={{this.recentCardsSection}}
          @viewOption={{this.activeViewId}}
          @isCompact={{@isCompact}}
          @handleCardSelect={{@handleCardSelect}}
          @isFocused={{eq this.focusedSection this.recentCardsSection.sid}}
          @isCollapsed={{this.isSectionCollapsed this.recentCardsSection.sid}}
          @onFocusSection={{this.onFocusSection}}
          @getDisplayedCount={{this.getDisplayedCount}}
          @onShowMore={{this.onShowMore}}
        />
      {{/if}}
    </div>
    <style scoped>
      .search-sheet-content {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow-y: auto;

        height: 100%;
        background-color: var(--boxel-light);
        border-bottom: 1px solid var(--boxel-200);
        padding: 0 var(--boxel-sp-lg);
        transition: opacity calc(var(--boxel-transition) / 4);
      }
      .search-sheet-content.compact {
        flex-direction: row;
        flex-wrap: nowrap;
        overflow-y: hidden;
        overflow-x: auto;
      }
      .search-sheet-content.compact :deep(.search-result-block) {
        margin-bottom: 0;
      }
    </style>
  </template>
}
