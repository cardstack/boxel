import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import Modifier from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';

import pluralize from 'pluralize';

import type { PickerOption } from '@cardstack/boxel-ui/components';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  type CodeRef,
  type Filter,
  type getCard,
  GetCardContextName,
  cardIdToURL,
} from '@cardstack/runtime-common';

import { cardTypeDisplayName } from '@cardstack/runtime-common/helpers/card-type-display-name';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';
import type { PrerenderedSearchResource } from '@cardstack/host/resources/prerendered-search';
import type LoaderService from '@cardstack/host/services/loader-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';

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
import type { CardDef } from '@cardstack/base/card-api';
import type { NamedArgs } from 'ember-modifier';

interface ScrollToFocusedSectionSignature {
  Element: HTMLElement;
  Args: {
    Positional: [];
    Named: { focusedSectionSid?: string | null; sectionSelector?: string };
  };
}

class ScrollToFocusedSection extends Modifier<ScrollToFocusedSectionSignature> {
  #previousSid: string | null = null;
  #rafId: number | null = null;

  modify(
    element: HTMLElement,
    // eslint-disable-next-line no-empty-pattern
    []: [],
    {
      focusedSectionSid,
      sectionSelector,
    }: NamedArgs<ScrollToFocusedSectionSignature>,
  ): void {
    const currentSid = focusedSectionSid ?? null;
    const prevSid = this.#previousSid;
    this.#previousSid = currentSid;

    // Cancel any pending scroll adjustment from a previous modify() call
    // so rapid toggles don't cause stale callbacks to fire.
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }

    if (currentSid && currentSid !== prevSid) {
      // Checking "show only" — section moved to top, scroll to top.
      // Defer to next frame so the DOM has re-rendered with the reordered sections;
      // otherwise the browser's scroll anchoring can shift position back.
      this.#rafId = requestAnimationFrame(() => {
        this.#rafId = null;
        element.scrollTop = 0;
      });
    } else if (!currentSid && prevSid && sectionSelector) {
      // Unchecking "show only" — scroll to the previously focused section.
      // Defer so the DOM has re-rendered with all sections restored.
      const targetSid = prevSid;
      this.#rafId = requestAnimationFrame(() => {
        this.#rafId = null;
        const sectionEl = element.querySelector(
          `${sectionSelector}[data-section-sid="${targetSid}"]`,
        ) as HTMLElement | null;
        sectionEl?.scrollIntoView({ block: 'start', behavior: 'auto' });
      });
    }
  }
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
    selectedCards?: (string | NewCardArgs)[];
    multiSelect?: boolean;
    onSelectAll?: (cards: string[]) => void;
    onDeselectAll?: () => void;
    baseFilter?: Filter;
    offerToCreate?: {
      ref: CodeRef;
      relativeTo: URL | undefined;
    };
    onSubmit?: (selection: string | NewCardArgs) => void;
    showHeader?: boolean;
    selectedCardTypes?: PickerOption[];
    filteredRecentCards?: CardDef[];
    searchResource: PrerenderedSearchResource;
    activeSort: SortOption;
    onSortChange: (sort: SortOption) => void;
  };
  Blocks: {};
}

export default class SearchContent extends Component<Signature> {
  @service declare loaderService: LoaderService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;
  @service declare store: StoreService;

  @tracked activeViewId = 'grid';
  /** Section id when focused: 'realm:<url>' or 'recents'. Null = no focus */
  @tracked focusedSection: string | null = null;
  @tracked displayedCountBySection: Record<string, number> = {};

  @consume(GetCardContextName) declare private getCard: getCard;

  @cached
  private get cardResource(): ReturnType<getCard> {
    return this.getCard(this, () => this.searchKeyAsURL);
  }

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

  private get summaryText(): string {
    if (this.args.isCompact) {
      return '';
    }

    if (this.args.searchResource.isLoading) {
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
    const total = this.args.searchResource.meta.page?.total ?? 0;
    const realms = this.realms;

    // Default: all results across all realms
    return `${pluralize('result', total, true)} across ${pluralize('realm', realms.length, true)}`;
  }

  private get sortedRecentCards(): CardDef[] {
    let cards = [...(this.args.filteredRecentCards ?? [])];

    // Apply type picker filter (from TypePicker selection)
    const pickerSelectedTypeNames = new Set(
      (this.args.selectedCardTypes ?? [])
        .filter((opt) => opt.type !== 'select-all')
        .map((opt) => opt.id),
    );
    if (pickerSelectedTypeNames.size > 0) {
      cards = cards.filter((card) =>
        pickerSelectedTypeNames.has(cardTypeDisplayName(card)),
      );
    }

    if (this.args.isCompact) {
      return cards;
    }
    let filtered = cards;
    const term = this.searchTerm;
    if (term) {
      const lowerTerm = term.toLowerCase();
      filtered = cards.filter((c) =>
        (c.cardTitle ?? '').toLowerCase().includes(lowerTerm),
      );
    }
    const sortOption = this.args.activeSort;
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
    this.args.onSortChange(option);
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
        iconURL: realmInfo?.iconURL ?? null,
        publishable: realmInfo?.publishable ?? null,
      },
    } as UrlSection;
  }

  private get filteredSearchResults(): PrerenderedCard[] {
    const selectedTypeNames = new Set(
      (this.args.selectedCardTypes ?? [])
        .filter((opt) => opt.type !== 'select-all')
        .map((opt) => opt.id),
    );

    const allCards = this.args.searchResource.instances;
    return selectedTypeNames.size > 0
      ? allCards.filter(
          (card) => card.cardType && selectedTypeNames.has(card.cardType),
        )
      : allCards;
  }

  private get cardsByQuerySection(): SearchSheetSection[] | null {
    if (this.searchKeyIsURL) {
      return null;
    }

    // In search-sheet mode (no baseFilter), skip when search key is empty
    if (!this.args.baseFilter && this.isSearchKeyEmpty) {
      return null;
    }

    const cards = this.filteredSearchResults;
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

    // Move focused section to front so it appears at the top
    if (this.focusedSection) {
      const idx = sections.findIndex((s) => s.sid === this.focusedSection);
      if (idx > 0) {
        const [focused] = sections.splice(idx, 1);
        sections.unshift(focused);
      }
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
      const url = cardIdToURL(cardIdOrUrl);
      return `${url.origin}${url.pathname.split('/').slice(0, -1)?.join('/') ?? ''}/`;
    } catch {
      return '';
    }
  }

  @action
  isSectionCollapsed(sectionId: string): boolean {
    return !!this.focusedSection && this.focusedSection !== sectionId;
  }

  private get allCards(): string[] {
    const urls: string[] = [];
    // Cards from search results (realm sections) - respects type filter
    for (const card of this.filteredSearchResults) {
      if (card.url) {
        urls.push(card.url.replace(/\.json$/, ''));
      }
    }
    // Cards from recents
    for (const card of this.sortedRecentCards) {
      if (card.id) {
        urls.push(card.id.replace(/\.json$/, ''));
      }
    }
    // Card from URL section
    if (this.resolvedCard?.id) {
      urls.push(this.resolvedCard.id.replace(/\.json$/, ''));
    }
    return [...new Set(urls)];
  }

  private get hasNoResults(): boolean {
    return (
      this.sections.length === 0 &&
      !this.args.searchResource.isLoading &&
      !this.shouldSkipQuery
    );
  }

  <template>
    <div
      {{ScrollToFocusedSection
        focusedSectionSid=this.focusedSection
        sectionSelector='[data-section-sid]'
      }}
      class='search-sheet-content {{if @isCompact "compact"}}'
      ...attributes
    >
      {{#if this.showHeader}}
        {{#unless @isCompact}}
          <SearchResultHeader
            @summaryText={{this.summaryText}}
            @viewOptions={{VIEW_OPTIONS}}
            @activeViewId={{this.activeViewId}}
            @activeSort={{@activeSort}}
            @sortOptions={{SORT_OPTIONS}}
            @onChangeView={{this.onChangeView}}
            @onChangeSort={{this.onChangeSort}}
            @multiSelect={{@multiSelect}}
            @selectedCards={{@selectedCards}}
            @allCards={{this.allCards}}
            @onSelectAll={{@onSelectAll}}
            @onDeselectAll={{@onDeselectAll}}
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
        {{#each this.sections key='sid' as |section i|}}
          <SearchResultSection
            @section={{section}}
            @viewOption={{this.activeViewId}}
            @handleSelect={{@handleSelect}}
            @isFocused={{eq this.focusedSection section.sid}}
            @isCollapsed={{this.isSectionCollapsed section.sid}}
            @onFocusSection={{this.onFocusSection}}
            @getDisplayedCount={{this.getDisplayedCount}}
            @onShowMore={{this.onShowMore}}
            @selectedCards={{@selectedCards}}
            @multiSelect={{@multiSelect}}
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
        overscroll-behavior: none;
        height: 100%;
        background-color: var(--boxel-light);
        transition: opacity calc(var(--boxel-transition) / 4);
      }
      .search-sheet-content.compact {
        flex-direction: row;
        flex-wrap: nowrap;
        padding-inline: var(--boxel-sp-xs);
        overflow-y: hidden;
        overflow-x: auto;
      }
      .search-sheet-content.compact :deep(.search-result-block) {
        margin-bottom: 0;
      }
      .empty-state {
        padding-block: var(--boxel-sp);
      }
    </style>
  </template>
}
