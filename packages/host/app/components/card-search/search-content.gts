import { isDestroyed, isDestroying } from '@ember/destroyable';
import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  type CodeRef,
  type Filter,
  type getCard,
  type getCardCollection,
  GetCardCollectionContextName,
  GetCardContextName,
  specRef,
} from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';
import { urlForRealmLookup } from '@cardstack/host/lib/utils';
import { getPrerenderedSearch } from '@cardstack/host/resources/prerendered-search';
import type LoaderService from '@cardstack/host/services/loader-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentCards from '@cardstack/host/services/recent-cards-service';
import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

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

import type { NewCardArgs } from './utils';

const OWNER_DESTROYED_ERROR = 'OWNER_DESTROYED_ERROR';

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
    // New args for card-catalog modal integration:
    selectedCardId?: string;
    baseFilter?: Filter;
    offerToCreate?: {
      ref: CodeRef;
      relativeTo: URL | undefined;
    };
    onCreateCard?: (args: NewCardArgs) => void;
    showRecents?: boolean;
    showHeader?: boolean;
  };
  Blocks: {};
}

export default class SearchContent extends Component<Signature> {
  @service declare loaderService: LoaderService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;
  @service declare recentCardsService: RecentCards;
  @service declare store: StoreService;

  @tracked activeViewId = 'grid';
  @tracked activeSort: SortOption = SORT_OPTIONS[0];
  /** Section id when focused: 'realm:<url>' or 'recents'. Null = no focus */
  @tracked focusedSection: string | null = null;
  @tracked displayedCountBySection: Record<string, number> = {};

  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;
  @tracked private recentCardCollection:
    | ReturnType<getCardCollection>
    | undefined;
  private getRecentCardCollection = () => {
    this.recentCardCollection = this.getCardCollection(
      this,
      () => this.recentCardsService.recentCardIds,
    );
  };

  @consume(GetCardContextName) declare private getCard: getCard;
  @tracked private cardResource: ReturnType<getCard> | undefined;
  private makeCardResource = () => {
    this.cardResource = this.getCard(this, () => this.searchKeyAsURL);
  };

  private searchPrerenderedCards = getPrerenderedSearch(
    this,
    getOwner(this)!,
    () => ({
      query: this.shouldSkipQuery ? undefined : this.query,
      format: 'fitted',
      realms: this.realms,
      isLive: true,
      cardComponentModifier: this.cardComponentModifier,
    }),
  );

  private get shouldSkipQuery() {
    // In baseFilter mode (modal), only skip when search key is a URL
    if (this.args.baseFilter) {
      return this.searchKeyIsURL;
    }
    // In search-sheet mode, skip when empty or URL
    return this.isSearchKeyEmpty || this.searchKeyIsURL;
  }

  private get showRecents() {
    return this.args.showRecents !== false;
  }

  private get showHeader() {
    return this.args.showHeader !== false;
  }

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

  private get resolvedCard() {
    return this.cardResource?.card;
  }

  private get isCardResourceLoaded() {
    return this.cardResource?.isLoaded ?? false;
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

    // Modal mode: use the externally-provided base filter
    if (this.args.baseFilter) {
      const searchTerm = searchKey?.trim() || undefined;
      return {
        filter: {
          every: [
            this.args.baseFilter,
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

    // Search-sheet mode: existing logic (type detection, specRef exclusion)
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
    if (this.args.isCompact) {
      return '';
    }

    if (this.searchPrerenderedCards.isLoading) {
      return 'Searching…';
    }

    // URL search result
    if (this.searchKeyIsURL) {
      if (!this.isCardResourceLoaded) {
        return 'Searching…';
      }
      return this.resolvedCard ? '1 result from 1 realm' : '0 results';
    }

    // Recents view (empty search or focused on recents)
    if (
      this.focusedSection === 'recents' ||
      (this.isSearchKeyEmpty && this.showRecents)
    ) {
      const count = this.recentCardsService.recentCardIds.length;
      return count === 1 ? '1 in Recent' : `${count} in Recents`;
    }

    // Query search results
    const total = this.searchPrerenderedCards.meta.page?.total ?? 0;
    const realms = this.realms;

    // Focused on a specific realm section
    if (this.focusedSection?.startsWith('realm:')) {
      const realmUrl = this.focusedSection.slice('realm:'.length);
      const realmInfo = this.realm.info(realmUrl);
      const realmName = realmInfo?.name ?? this.realmNameFromUrl(realmUrl);
      const realmTotal = this.resultCountByRealm[realmUrl];

      if (typeof realmTotal === 'number') {
        return `${total} result${total === 1 ? '' : 's'} across ${realms.length} realm${realms.length === 1 ? '' : 's'}, ${realmTotal} result${realmTotal === 1 ? '' : 's'} in ${realmName}`;
      }

      return `${total} result${total === 1 ? '' : 's'} in ${realmName}`;
    }

    // Default: all results across all realms
    return `${total} result${total === 1 ? '' : 's'} across ${realms.length} realm${realms.length === 1 ? '' : 's'}`;
  }

  private get sortedRecentCards(): CardDef[] {
    const cards = this.recentCardCollection?.cards.filter(Boolean) as CardDef[];
    if (!cards) {
      return [];
    }
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

  private get cardsByQuerySection(): SearchSheetSection[] | null {
    if (this.searchKeyIsURL) {
      return null;
    }

    // In search-sheet mode (no baseFilter), skip when search key is empty
    if (!this.args.baseFilter && this.isSearchKeyEmpty) {
      return null;
    }

    const cards = this.searchPrerenderedCards.instances;
    const byRealm = new Map<string, PrerenderedCard[]>();

    for (const card of cards) {
      const list: PrerenderedCard[] = byRealm.get(card.realmUrl) ?? [];
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
        cards: realmCards,
        totalCount: realmCards.length,
      });
    }

    return sections;
  }

  private get resultCountByRealm(): Record<string, number> {
    const sections = this.cardsByQuerySection ?? [];
    const counts: Record<string, number> = {};
    for (const section of sections) {
      if (section.type === 'realm') {
        counts[section.realmUrl] = section.totalCount;
      }
    }
    return counts;
  }

  private get sections(): SearchSheetSection[] {
    const sections: SearchSheetSection[] = [];

    // Add URL section if present
    if (this.cardByUrlSection) {
      sections.push(this.cardByUrlSection);
    }

    // Add query sections if present
    if (this.cardsByQuerySection) {
      sections.push(...this.cardsByQuerySection);
    }

    // Add recents section if enabled
    if (this.showRecents && this.recentCardsSection) {
      sections.push(this.recentCardsSection);
    }

    return sections;
  }

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

  private get cardComponentModifier() {
    if (isDestroying(this) || isDestroyed(this)) {
      return undefined;
    }
    try {
      return (this as any).args.context?.cardComponentModifier;
    } catch (e: any) {
      if (e.message && e.message.includes(OWNER_DESTROYED_ERROR)) {
        return undefined;
      }
      throw e;
    }
  }

  @action
  isSectionCollapsed(sectionId: string): boolean {
    return !!this.focusedSection && this.focusedSection !== sectionId;
  }

  private get hasNoResults(): boolean {
    return (
      this.sections.length === 0 &&
      !this.searchPrerenderedCards.isLoading &&
      !this.shouldSkipQuery
    );
  }

  <template>
    {{consumeContext this.getRecentCardCollection}}
    {{consumeContext this.makeCardResource}}
    <div class='search-sheet-content {{if @isCompact "compact"}}'>
      {{#if this.showHeader}}
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
      {{/if}}

      {{! Handle empty URL search state — only after loading completes }}
      {{#if this.searchKeyIsURL}}
        {{#if this.isCardResourceLoaded}}
          {{#unless this.resolvedCard}}
            <div class='empty-state' data-test-search-sheet-empty>
              No card found at
              {{@searchKey}}
            </div>
          {{/unless}}
        {{/if}}
      {{/if}}

      {{! Render all sections }}
      {{#each this.sections as |section i|}}
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
          @selectedCardId={{@selectedCardId}}
          @offerToCreate={{@offerToCreate}}
          @onCreateCard={{@onCreateCard}}
          data-test-search-result-section={{i}}
        />
      {{/each}}

      {{#if this.hasNoResults}}
        <div class='empty-state' data-test-search-content-empty>
          No cards available
        </div>
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
