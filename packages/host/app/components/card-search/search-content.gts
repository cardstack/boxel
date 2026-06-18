import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import Modifier from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';

import pluralize from 'pluralize';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import {
  type CodeRef,
  type Filter,
  type getCard,
  type getCardCollection,
  type RenderableSearchEntryLike,
  type SearchEntryWireQuery,
  GetCardContextName,
  GetCardCollectionContextName,
  internalKeyFor,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common';

import AdornContext from '@cardstack/host/components/adorn/adorn-context';
import type { RealmFilter } from '@cardstack/host/components/realm-picker';
import type { TypeFilter } from '@cardstack/host/components/type-picker';
import { getRenderableSearchEntries } from '@cardstack/host/resources/renderable-search-entries';
import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentCards from '@cardstack/host/services/recent-cards-service';

import {
  buildRecentsQuery,
  buildSearchQuery,
  shouldSkipSearchQuery,
} from '@cardstack/host/utils/card-search/query-builder';
import { SectionPagination } from '@cardstack/host/utils/card-search/section-pagination';
import {
  assembleSections,
  buildLiveRecentsSection,
  buildQuerySections,
  buildRecentsSection,
  buildUrlSection,
  type SearchSheetSection,
} from '@cardstack/host/utils/card-search/sections';
import type { NewCardArgs } from '@cardstack/host/utils/card-search/types';
import {
  isURLSearchKey,
  resolveSearchKeyAsURL,
} from '@cardstack/host/utils/card-search/url';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { SORT_OPTIONS, VIEW_OPTIONS, type SortOption } from './constants';
import SearchResultHeader from './search-result-header';
import SearchResultSection from './search-result-section';

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
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- scroll adjustment needs post-paint layout
      this.#rafId = requestAnimationFrame(() => {
        this.#rafId = null;
        element.scrollTop = 0;
      });
    } else if (!currentSid && prevSid && sectionSelector) {
      // Unchecking "show only" — scroll to the previously focused section.
      // Defer so the DOM has re-rendered with all sections restored.
      const targetSid = prevSid;
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- scroll adjustment needs post-paint layout
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

interface Signature {
  Element: HTMLElement;
  Args: {
    searchKey: string;
    realmFilter: RealmFilter;
    typeFilter: TypeFilter;
    baseFilter?: Filter;
    isCompact: boolean;
    handleSelect: (selection: string | NewCardArgs) => void;
    selectedCards?: (string | NewCardArgs)[];
    multiSelect?: boolean;
    onSelectAll?: (cards: string[]) => void;
    onDeselectAll?: () => void;
    offerToCreate?: {
      ref: CodeRef;
      relativeTo: URL | undefined;
    };
    onSubmit?: (selection: string | NewCardArgs) => void;
    showHeader?: boolean;
    activeSort: SortOption;
    onSortChange: (sort: SortOption) => void;
    initialFocusedSection?: string | null;
    // When true, search-result cards render the Adorn visual treatment
    // (teal hover type-label tab + teal selection chip).
    adorn?: boolean;
  };
  Blocks: {};
}

/**
 * @deprecated Root of the legacy search-results tree (`SearchContent` →
 * `SearchResultSection` → `ItemButton`). Favor the v2 `<SearchResults>`
 * component, which renders the heterogeneous `search-entry` stream (prerendered
 * HTML inert or live card) for a `search-entry`-rooted query. This sheet now
 * sources its data from the v2 `getSearchEntriesResource` (via
 * `getRenderableSearchEntries`); the bespoke section / multiselect / adorn
 * rendering is why it isn't yet folded into `<SearchResults>`. Removed once
 * every consumer is on v2.
 */
export default class SearchContent extends Component<Signature> {
  @service declare network: NetworkService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;
  @service('recent-cards-service')
  declare private recentCardsService: RecentCards;

  @tracked activeViewId = 'grid';
  private pagination = new SectionPagination(this.args.initialFocusedSection);

  @consume(GetCardContextName) declare private getCard: getCard;
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;

  private get searchKeyIsURL() {
    return isURLSearchKey(this.args.searchKey);
  }

  private get searchKeyAsURL() {
    return resolveSearchKeyAsURL(
      this.args.searchKey,
      this.realmServer.availableRealmIdentifiers,
    );
  }

  @cached
  private get cardResource(): ReturnType<getCard> {
    return this.getCard(this, () => this.searchKeyAsURL);
  }

  private get resolvedCard(): CardDef | undefined {
    return this.cardResource?.card;
  }

  private get isCardResourceLoaded(): boolean {
    return this.cardResource?.isLoaded ?? false;
  }

  // The v2 `search-entry` query for the main realm search, adapted from the
  // legacy `Query` builder. Fitted is the default rendering, so no `htmlQuery`
  // override is needed; realms ride alongside. Undefined leaves the search idle
  // (the skip cases: empty search key or a URL paste, handled separately).
  private get mainSearchQuery(): SearchEntryWireQuery | undefined {
    if (shouldSkipSearchQuery(this.args.searchKey, this.args.baseFilter)) {
      return undefined;
    }
    const selectedTypeIds = this.args.typeFilter.selected.map((ref) =>
      internalKeyFor(ref, undefined, this.network.virtualNetwork),
    );
    return {
      ...searchEntryWireQueryFromQuery(
        buildSearchQuery(
          this.args.searchKey,
          this.args.activeSort,
          this.args.baseFilter,
          selectedTypeIds,
        ),
      ),
      realms: this.args.realmFilter.selectedURLs,
    };
  }

  // Created once: the resource owns its realm subscriptions and re-runs through
  // the reactive query thunk. Rows render inert (`mode='none'`); the
  // operator-mode overlay attaches via each HydratableCard's own card context.
  private searchEntries = getRenderableSearchEntries(
    this,
    () => this.mainSearchQuery,
    () => 'none',
  );

  private get recentCardUrls(): string[] {
    return this.recentCardsService.recentCardIds.map((id) =>
      id.endsWith('.json') ? id : `${id}.json`,
    );
  }

  // The recent card ids stripped of any `.json` extension, used to order the
  // recents results most-recent-first against the bare `entry.id`.
  private get recentCardBareIds(): string[] {
    return this.recentCardsService.recentCardIds.map((id) =>
      id.replace(/\.json$/, ''),
    );
  }

  // Only query realms that actually host one of the recent cards. The main
  // searchResource hits every available realm (good for free-text search),
  // but for Recents we already know the exact URL of each card, so searching
  // realms that can't possibly contain them is pointless — and in tests
  // that mix origins (e.g. baseRealm + testRealm + testModuleRealm at a
  // different server), assertOwnRealmServer throws on the mixed set.
  private get recentsSearchRealms(): string[] {
    const realms = new Set<string>();
    for (const url of this.recentCardUrls) {
      const realm = this.realms.find((r) => url.startsWith(r));
      if (realm) {
        realms.add(realm);
      }
    }
    return [...realms];
  }

  // Recents always render as prerendered HTML to avoid fetching card modules
  // when the search sheet opens. Compact mode uses an empty query scoped to the
  // recent card URLs and reorders client-side to most-recent-first; full mode
  // reuses the realm-section query so sort, type filter, and search-term filter
  // all apply server-side alongside the cardUrls constraint. Undefined (no
  // recents) leaves the resource idle.
  private get recentsSearchQuery(): SearchEntryWireQuery | undefined {
    if (this.recentCardUrls.length === 0) {
      return undefined;
    }
    if (this.args.isCompact) {
      return {
        ...searchEntryWireQueryFromQuery({}),
        realms: this.realms,
        cardUrls: this.recentCardUrls,
      };
    }
    // No selected realm hosts a recent card. The v2 search treats an empty
    // `realms` array as "search every realm", which — with the `cardUrls`
    // constraint still matching them — would resurface recents from realms the
    // user filtered out. Suppress the recents query instead, matching the
    // legacy behavior.
    if (this.recentsSearchRealms.length === 0) {
      return undefined;
    }
    const selectedTypeIds = this.args.typeFilter.selected.map((ref) =>
      internalKeyFor(ref, undefined, this.network.virtualNetwork),
    );
    return {
      ...searchEntryWireQueryFromQuery(
        buildRecentsQuery(
          this.searchTerm,
          this.args.activeSort,
          this.args.baseFilter,
          selectedTypeIds,
        ),
      ),
      realms: this.recentsSearchRealms,
      cardUrls: this.recentCardUrls,
    };
  }

  private recentsEntries = getRenderableSearchEntries(
    this,
    () => this.recentsSearchQuery,
    () => 'none',
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

  private get searchTerm(): string | undefined {
    if (this.isSearchKeyEmpty || this.searchKeyIsURL) {
      return undefined;
    }
    return this.args.searchKey?.trim();
  }

  private get realms() {
    const urls =
      this.args.realmFilter.selectedURLs.length > 0
        ? this.args.realmFilter.selectedURLs
        : this.realmServer.availableRealmIdentifiers;
    return urls ?? [];
  }

  private get summaryText(): string {
    if (this.args.isCompact) {
      return '';
    }

    if (this.searchEntries.isLoading) {
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
    const total = this.searchEntries.meta.page?.total ?? 0;
    const realms = this.realms;

    // Default: all results across all realms
    return `${pluralize('result', total, true)} across ${pluralize('realm', realms.length, true)}`;
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
    this.pagination.focus(sectionId);
  }

  getDisplayedCount = (sectionId: string, totalCount: number): number => {
    return this.pagination.getDisplayedCount(sectionId, totalCount);
  };

  @action
  onShowMore(sectionId: string, totalCount: number) {
    this.pagination.showMore(sectionId, totalCount);
  }

  @cached
  private get recentCardCollection(): ReturnType<getCardCollection> | null {
    // Only instantiate the collection when we actually need the fallback,
    // so the happy path (prerendered succeeds) never loads card modules.
    if (!this.needsLiveRecentsFallback) {
      return null;
    }
    return this.getCardCollection(
      this,
      () => this.recentCardsService.recentCardIds,
    );
  }

  private get needsLiveRecentsFallback(): boolean {
    // Use the live CardDef path only when the prerendered fetch threw —
    // e.g. a multi-realm test setup where federated search can't be
    // authorized. An empty prerendered result is legitimate (filter/realm
    // excluded all recents) and must NOT trigger the fallback, or we'd
    // resurrect cards the user filtered out.
    return (
      this.recentCardUrls.length > 0 &&
      (this.recentsEntries.errors?.length ?? 0) > 0
    );
  }

  private get liveRecentCards(): CardDef[] {
    const collection = this.recentCardCollection;
    if (!collection) return [];
    return (collection.cards?.filter(Boolean) as CardDef[] | undefined) ?? [];
  }

  private get recentCardsSection() {
    const instances = this.recentsEntries.entries;

    if (this.needsLiveRecentsFallback) {
      return buildLiveRecentsSection(this.liveRecentCards);
    }

    if (this.args.isCompact) {
      // Preserve most-recent-first order from RecentCardsService rather
      // than the arbitrary order the server returns for an unsorted query.
      // `entry.id` is the bare card URL, so we order by the bare recent ids.
      let byId = new Map<string, RenderableSearchEntryLike>();
      for (let entry of instances) {
        byId.set(entry.id, entry);
      }
      let ordered = this.recentCardBareIds
        .map((id) => byId.get(id))
        .filter((e): e is RenderableSearchEntryLike => e !== undefined);
      return buildRecentsSection(ordered);
    }
    // Full mode: server already applied sort/filter/search, use the
    // response order directly.
    return buildRecentsSection([...instances]);
  }

  private get cardByUrlSection() {
    return buildUrlSection(
      this.resolvedCard,
      this.searchKeyIsURL,
      this.realms,
      this.realm,
    );
  }

  private get cardsByQuerySection() {
    return buildQuerySections(this.searchEntries.entries, {
      isURL: this.searchKeyIsURL,
      isSearchKeyEmpty: this.isSearchKeyEmpty,
      hasBaseFilter: !!this.args.baseFilter,
      realmURLs: this.realms,
      offerToCreate: this.args.offerToCreate,
      realm: this.realm,
    });
  }

  private get sections(): SearchSheetSection[] {
    return assembleSections(
      this.recentCardsSection,
      this.cardByUrlSection,
      this.cardsByQuerySection,
      this.pagination.focusedSection,
    );
  }

  @action
  isSectionCollapsed(sectionId: string): boolean {
    return this.pagination.isCollapsed(sectionId);
  }

  private get allCards(): string[] {
    const urls: string[] = [];
    // Cards from search results (realm sections) - respects type filter
    for (const entry of this.searchEntries.entries) {
      if (entry.id) {
        urls.push(entry.id.replace(/\.json$/, ''));
      }
    }
    // Cards from recents
    for (const entry of this.recentsEntries.entries) {
      urls.push(entry.id.replace(/\.json$/, ''));
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
      !this.searchEntries.isLoading &&
      !this.shouldSkipQuery
    );
  }

  <template>
    <div
      {{ScrollToFocusedSection
        focusedSectionSid=this.pagination.focusedSection
        sectionSelector='[data-section-sid]'
      }}
      class={{cn 'search-sheet-content' compact=@isCompact}}
      ...attributes
    >
      {{! AdornContext aligns with this search-sheet-content div as
          the visual region for adorn-decorated items. The Adorn
          tokens + outline rules anchor here, so child ItemButtons
          don't need to re-establish them per item. We thread the
          yielded `strokeClass` down to each ItemButton rather than
          letting them hard-code it. Harmless when @adorn is false (no
          adorn-decorated descendants for the rules to match). }}
      <AdornContext as |adorn|>
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
              @adorn={{@adorn}}
              @adornStrokeClass={{adorn.strokeClass}}
              @adornPositionLabel={{adorn.positionLabel}}
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
              @isFocused={{eq this.pagination.focusedSection section.sid}}
              @isCollapsed={{this.isSectionCollapsed section.sid}}
              @onFocusSection={{this.onFocusSection}}
              @getDisplayedCount={{this.getDisplayedCount}}
              @onShowMore={{this.onShowMore}}
              @selectedCards={{@selectedCards}}
              @multiSelect={{@multiSelect}}
              @offerToCreate={{@offerToCreate}}
              @onSubmit={{@onSubmit}}
              @adorn={{@adorn}}
              @adornStrokeClass={{adorn.strokeClass}}
              @adornPositionLabel={{adorn.positionLabel}}
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
      </AdornContext>
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
        /* `overflow-y: auto` also clips horizontal overflow, so the
           Adorn outline stroke and type-label tab (which extend a few
           px outside each card) get cut off on the top/left edges
           without room. Block + inline-start padding keeps them inside
           the clip region; the larger inline-end padding is the
           existing scrollbar gutter. */
        padding-block: var(--boxel-sp-xs);
        padding-inline: var(--boxel-sp-xs) var(--boxel-sp);
        transition: opacity calc(var(--boxel-transition) / 4);
      }
      .search-sheet-content.compact {
        flex-direction: row;
        flex-wrap: nowrap;
        /* Top-align the result cards so each keeps its natural height
           (title + realm caption) instead of stretching to the row and
           clipping the caption. The slack then falls below the cards,
           where it leaves room for the horizontal scrollbar — so the
           bottom caption clears it instead of being cropped behind it. */
        align-items: flex-start;
        padding-inline: var(--boxel-sp-xs);
        /* `overflow-y: hidden` (needed so only the row scrolls
           horizontally) would clip the Adorn outline stroke and the
           hover type-label tab, which flips below the card. Bias the
           block padding toward the block-end so the tab has room below
           (the block-start only needs to clear the outline stroke),
           working with the taller prompt sheet (--search-sheet-prompt-height). */
        padding-block: var(--boxel-sp-2xs) var(--boxel-sp);
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
