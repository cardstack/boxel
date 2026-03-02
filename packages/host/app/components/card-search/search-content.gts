import { isDestroyed, isDestroying } from '@ember/destroyable';
import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import pluralize from 'pluralize';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  type CodeRef,
  type Filter,
  CardContextName,
  type getCard,
  type getCardCollection,
  GetCardCollectionContextName,
  GetCardContextName,
  getTypeRefsFromFilter,
  type TypeRefResult,
  identifyCard,
  isBaseDef,
  isResolvedCodeRef,
  specRef,
} from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';
import { urlForRealmLookup } from '@cardstack/host/lib/utils';
import ScrollAnchor from '@cardstack/host/modifiers/scroll-anchor';
import { getPrerenderedSearch } from '@cardstack/host/resources/prerendered-search';
import type LoaderService from '@cardstack/host/services/loader-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentCards from '@cardstack/host/services/recent-cards-service';
import type StoreService from '@cardstack/host/services/store';

import type { CardContext, CardDef } from 'https://cardstack.com/base/card-api';

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

function cardMatchesTypeRef(card: CardDef, typeRef: CodeRef): boolean {
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

export interface RealmSectionInfo {
  name: string;
  iconURL: string | null;
  publishable: boolean | null;
}

export interface RealmSection {
  sid: string;
  type: 'realm';
  realmUrl: string;
  realmInfo: RealmSectionInfo;
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
  realmInfo: RealmSectionInfo;
}

export type SearchSheetSection = RealmSection | RecentsSection | UrlSection;

interface Signature {
  Element: HTMLElement;
  Args: {
    searchKey: string;
    selectedRealmURLs: string[];
    isCompact: boolean;
    handleSelect: (selection: string | NewCardArgs) => void;
    selectedCard?: string | NewCardArgs;
    baseFilter?: Filter;
    offerToCreate?: {
      ref: CodeRef;
      relativeTo: URL | undefined;
    };
    onSubmit?: (selection: string | NewCardArgs) => void;
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
  @tracked scrollAnchorSid: string | null = null;

  private get scrollAnchorSelector(): string | null {
    if (this.scrollAnchorSid) {
      return `[data-section-sid="${this.scrollAnchorSid}"]`;
    }
    return null;
  }

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

  @consume(CardContextName) declare private cardContext:
    | CardContext
    | undefined;
  @consume(GetCardContextName) declare private getCard: getCard;
  @tracked private cardResource: ReturnType<getCard> | undefined;
  private makeCardResource = () => {
    this.cardResource = this.getCard(this, () => this.searchKeyAsURL);
  };

  private get filterTypeRef(): TypeRefResult[] | undefined {
    const filter = this.args.baseFilter;
    // baseFilter takes precedence; searchKey fallback is only used in search-sheet mode
    if (filter) {
      return getTypeRefsFromFilter(filter);
    }
    // Search-sheet mode: extract type from carddef: search key (searchForInstances)
    const ref = getCodeRefFromSearchKey(this.args.searchKey);
    return ref ? [{ ref, negated: false }] : undefined;
  }

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

  private get searchTerm(): string | undefined {
    if (this.isSearchKeyEmpty || this.searchKeyIsURL) {
      return undefined;
    }
    const type = getCodeRefFromSearchKey(this.args.searchKey);
    return type ? undefined : this.args.searchKey;
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

    // Query search results
    const total = this.searchPrerenderedCards.meta.page?.total ?? 0;
    const realms = this.realms;

    // Default: all results across all realms
    return `${pluralize('result', total, true)} across ${pluralize('realm', realms.length, true)}`;
  }

  private get sortedRecentCards(): CardDef[] {
    const cards = this.recentCardCollection?.cards.filter(Boolean) as CardDef[];
    if (!cards) {
      return [];
    }
    const realms = this.realms;
    const realmFiltered = cards.filter(
      (c) => c.id && realms.some((realmUrl) => c.id.startsWith(realmUrl)),
    );

    // Apply type filter when baseFilter specifies a type (modal/chooseCard mode)
    const typeRefs = this.filterTypeRef;
    const positiveRefs = typeRefs?.filter((r) => !r.negated).map((r) => r.ref);
    const negatedRefs = typeRefs?.filter((r) => r.negated).map((r) => r.ref);
    let typeFiltered = realmFiltered;
    if (positiveRefs?.length) {
      typeFiltered = typeFiltered.filter((c) =>
        positiveRefs.some((ref) => cardMatchesTypeRef(c, ref)),
      );
    }
    if (negatedRefs?.length) {
      typeFiltered = typeFiltered.filter(
        (c) => !negatedRefs.some((ref) => cardMatchesTypeRef(c, ref)),
      );
    }

    if (this.args.isCompact) {
      return typeFiltered;
    }
    let filtered = typeFiltered;
    const term = this.searchTerm;
    if (term) {
      const lowerTerm = term.toLowerCase();
      filtered = typeFiltered.filter((c) =>
        (c.cardTitle ?? '').toLowerCase().includes(lowerTerm),
      );
    }
    const sortOption = this.activeSort;
    const displayName = sortOption.displayName;
    return [...filtered].sort((a, b) => {
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

  private get recentCardsSection(): RecentsSection | undefined {
    const cards = this.sortedRecentCards;
    if (cards.length === 0) {
      return undefined;
    }
    return {
      sid: 'recents',
      type: 'recents',
      cards,
      totalCount: cards.length,
    };
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
    this.scrollAnchorSid = sectionId ?? this.focusedSection;

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
        iconURL: realmInfo?.iconURL ?? null,
        publishable: realmInfo?.publishable ?? null,
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
          iconURL: realmInfo?.iconURL ?? null,
          publishable: realmInfo?.publishable ?? null,
        },
        cards: realmCards,
        totalCount: realmCards.length,
      });
    }

    // When offerToCreate is provided, include empty sections for all
    // available/selected realms that have no results, so users can
    // create new cards in those realms.
    if (this.args.offerToCreate) {
      for (const realmUrl of this.realms) {
        if (!byRealm.has(realmUrl)) {
          const realmInfo = this.realm.info(realmUrl);
          sections.push({
            sid: `realm:${realmUrl}`,
            type: 'realm',
            realmUrl,
            realmInfo: {
              name: realmInfo?.name ?? this.realmNameFromUrl(realmUrl),
              iconURL: realmInfo?.iconURL ?? null,
              publishable: realmInfo?.publishable ?? null,
            },
            cards: [],
            totalCount: 0,
          });
        }
      }
    }

    return sections;
  }

  private get sections(): SearchSheetSection[] {
    const sections: SearchSheetSection[] = [];

    // Add recents section if present
    if (this.recentCardsSection) {
      sections.push(this.recentCardsSection);
    }

    // Add URL section if present
    if (this.cardByUrlSection) {
      sections.push(this.cardByUrlSection);
    }

    // Add query sections if present
    if (this.cardsByQuerySection) {
      sections.push(...this.cardsByQuerySection);
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
      return this.cardContext?.cardComponentModifier;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(OWNER_DESTROYED_ERROR)
      ) {
        return undefined;
      }
      throw error;
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
    <div
      {{ScrollAnchor
        trackSelector='[data-section-sid]'
        anchorSelector=this.scrollAnchorSelector
      }}
      class='search-sheet-content {{if @isCompact "compact"}}'
    >
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

      {{#if @isCompact}}
        {{#if this.recentCardsSection}}
          <SearchResultSection
            @section={{this.recentCardsSection}}
            @isCompact={{true}}
            @handleSelect={{@handleSelect}}
            data-test-search-result-section='recent-cards'
          />
        {{/if}}
      {{else}}
        {{! Render all sections }}
        {{#each this.sections as |section i|}}
          <SearchResultSection
            @section={{section}}
            @viewOption={{this.activeViewId}}
            @handleSelect={{@handleSelect}}
            @isFocused={{eq this.focusedSection section.sid}}
            @isCollapsed={{this.isSectionCollapsed section.sid}}
            @onFocusSection={{this.onFocusSection}}
            @getDisplayedCount={{this.getDisplayedCount}}
            @onShowMore={{this.onShowMore}}
            @selectedCard={{@selectedCard}}
            @offerToCreate={{@offerToCreate}}
            @onSubmit={{@onSubmit}}
            data-section-sid={{section.sid}}
            data-test-search-result-section={{i}}
          />
        {{/each}}
      {{/if}}

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
