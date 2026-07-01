import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import Modifier from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import {
  type CodeRef,
  type Filter,
  type getCard,
  type SearchEntryWireQuery,
  GetCardContextName,
  internalKeyFor,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common';

import AdornContext from '@cardstack/host/components/adorn/adorn-context';
import type { RealmFilter } from '@cardstack/host/components/realm-picker';
import type { TypeFilter } from '@cardstack/host/components/type-picker';
import type NetworkService from '@cardstack/host/services/network';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentCards from '@cardstack/host/services/recent-cards-service';

import {
  buildRecentsQuery,
  buildSearchQuery,
  shouldSkipSearchQuery,
} from '@cardstack/host/utils/card-search/query-builder';
import { SectionPagination } from '@cardstack/host/utils/card-search/section-pagination';
import type { NewCardArgs } from '@cardstack/host/utils/card-search/types';
import {
  isURLSearchKey,
  resolveSearchKeyAsURL,
} from '@cardstack/host/utils/card-search/url';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { SECTION_DISPLAY_LIMIT_FOCUSED, type SortOption } from './constants';
import LiveRecentsProvider from './live-recents-provider';
import SearchResults from './search-results';
import SheetResults from './sheet-results';

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
    // When true, search-result tiles render the Adorn visual treatment
    // (teal hover type-label tab + teal selection chip).
    adorn?: boolean;
    // Opt-in visual variant. 'mini' forces single-line rows, suppresses the
    // per-section "show only" toggle, hides the grid/strip view picker, and
    // un-hides the recents count — used by MiniCardChooser.
    variant?: 'default' | 'mini';
  };
  Blocks: {};
}

// The results pane of the search sheet / card chooser. Renders through the v2
// `<SearchResults>` component family: one instance for the realm search, a
// nested one for recents (with the live-recents fallback layered in), then hands
// their yielded `search-entry` streams to `<SheetResults>`, which lays them out
// into realm / recents / URL-paste sections (with the header, multiselect, the
// Adorn treatment, pagination, and the result count). Resources are
// construct-once: the two `<SearchResults>` own their live-search resources
// (varied only through their `@query` thunk), the URL-paste `getCard` is a
// `@cached` getter, and the live-recents fallback's `getCardCollection` lives in
// `LiveRecentsProvider` — none built in a getter-per-render.
export default class PanelContent extends Component<Signature> {
  @service declare network: NetworkService;
  @service declare realmServer: RealmServerService;
  @service('recent-cards-service')
  declare private recentCardsService: RecentCards;

  @tracked activeViewId = 'grid';
  pagination = new SectionPagination(this.args.initialFocusedSection);

  @consume(GetCardContextName) declare private getCard: getCard;

  get searchKeyIsURL() {
    return isURLSearchKey(this.args.searchKey);
  }

  private get searchKeyAsURL() {
    return resolveSearchKeyAsURL(
      this.args.searchKey,
      this.realmServer.availableRealmIdentifiers,
    );
  }

  // Construct-once (`@cached`, so the consumed `getCard` provider is injected
  // before it runs); the resolved URL varies through the reactive thunk.
  @cached
  private get cardResource(): ReturnType<getCard> {
    return this.getCard(this, () => this.searchKeyAsURL);
  }

  get resolvedCard(): CardDef | undefined {
    return this.cardResource?.card;
  }

  get isCardResourceLoaded(): boolean {
    return this.cardResource?.isLoaded ?? false;
  }

  // The v2 `search-entry` query for the main realm search, built from the
  // shared `Query` builder via `searchEntryWireQueryFromQuery`. Fitted is the
  // default rendering, so no `htmlQuery` override is needed; realms ride
  // alongside. Undefined leaves the search idle (the skip cases: empty search
  // key or a URL paste, handled separately).
  get mainSearchQuery(): SearchEntryWireQuery | undefined {
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
      // Cap each realm's results at the focused-section display limit — the
      // most the sheet ever shows in one section. The v2 search applies
      // `page.size` per realm (so every realm section is still represented) and
      // still reports the full match count in `meta.page.total` (which drives
      // the result-count summary), so this only trims rows the sheet would
      // never render — a large payload reduction on broad queries.
      page: { size: SECTION_DISPLAY_LIMIT_FOCUSED },
    };
  }

  get recentCardUrls(): string[] {
    return this.recentCardsService.recentCardIds.map((id) =>
      id.endsWith('.json') ? id : `${id}.json`,
    );
  }

  // The recent card ids stripped of any `.json` extension, used to order the
  // recents results most-recent-first against the bare `entry.id`.
  get recentCardBareIds(): string[] {
    return this.recentCardsService.recentCardIds.map((id) =>
      id.replace(/\.json$/, ''),
    );
  }

  // Only query realms that actually host one of the recent cards. The main
  // search hits every available realm (good for free-text search), but for
  // Recents we already know the exact URL of each card, so searching realms
  // that can't possibly contain them is pointless — and in tests that mix
  // origins (e.g. baseRealm + testRealm + testModuleRealm at a different
  // server), assertOwnRealmServer throws on the mixed set.
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
  get recentsSearchQuery(): SearchEntryWireQuery | undefined {
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
    // user filtered out. Suppress the recents query instead, so a filtered-out
    // realm's recents never reappear.
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

  get shouldSkipQuery() {
    // In baseFilter mode (modal), only skip when search key is a URL
    if (this.args.baseFilter) {
      return this.searchKeyIsURL;
    }
    // In search-sheet mode, skip when empty or URL
    return this.isSearchKeyEmpty || this.searchKeyIsURL;
  }

  get showHeader() {
    return this.args.showHeader !== false;
  }

  get isSearchKeyEmpty() {
    return (this.args.searchKey?.trim() ?? '') === '';
  }

  private get searchTerm(): string | undefined {
    if (this.isSearchKeyEmpty || this.searchKeyIsURL) {
      return undefined;
    }
    return this.args.searchKey?.trim();
  }

  get realms() {
    const urls =
      this.args.realmFilter.selectedURLs.length > 0
        ? this.args.realmFilter.selectedURLs
        : this.realmServer.availableRealmIdentifiers;
    return urls ?? [];
  }

  get recentCardIds(): string[] {
    return this.recentCardsService.recentCardIds;
  }

  @action
  onChangeView(id: string) {
    this.activeViewId = id;
  }

  @action
  onChangeSort(option: SortOption) {
    this.args.onSortChange(option);
  }

  <template>
    <div
      {{ScrollToFocusedSection
        focusedSectionSid=this.pagination.focusedSection
        sectionSelector='[data-section-sid]'
      }}
      class={{cn
        'search-sheet-content'
        compact=@isCompact
        mini=(eq @variant 'mini')
      }}
      ...attributes
    >
      {{! AdornContext aligns with this search-sheet-content div as the visual
          region for adorn-decorated items. The Adorn tokens + outline rules
          anchor here, so child tiles don't need to re-establish them per item;
          the yielded strokeClass / positionLabel thread down to each tile.
          Harmless when @adorn is false (no adorn-decorated descendants for the
          rules to match). }}
      <AdornContext as |adorn|>
        {{! The two `<SearchResults>` sit at fixed positions (never inside a
            toggling if/each), so they never unmount while typing; each owns its
            live-search resource and re-runs only through its `@query` thunk.
            `<SheetResults>` derives the sections / count / multiselect from the
            yielded results — no parallel search resource. }}
        <SearchResults
          @query={{this.mainSearchQuery}}
          @mode='none'
          as |mainResults|
        >
          <SearchResults
            @query={{this.recentsSearchQuery}}
            @mode='none'
            as |recentsResults|
          >
            <LiveRecentsProvider
              @cardIds={{this.recentCardIds}}
              @recentsResults={{recentsResults}}
              as |liveRecentCards|
            >
              <SheetResults
                @mainResults={{mainResults}}
                @recentsResults={{recentsResults}}
                @liveRecentCards={{liveRecentCards}}
                @isCompact={{@isCompact}}
                @variant={{@variant}}
                @showHeader={{this.showHeader}}
                @searchKey={{@searchKey}}
                @searchKeyIsURL={{this.searchKeyIsURL}}
                @isSearchKeyEmpty={{this.isSearchKeyEmpty}}
                @shouldSkipQuery={{this.shouldSkipQuery}}
                @resolvedCard={{this.resolvedCard}}
                @isCardResourceLoaded={{this.isCardResourceLoaded}}
                @realms={{this.realms}}
                @baseFilter={{@baseFilter}}
                @offerToCreate={{@offerToCreate}}
                @recentCardBareIds={{this.recentCardBareIds}}
                @pagination={{this.pagination}}
                @activeViewId={{this.activeViewId}}
                @activeSort={{@activeSort}}
                @onChangeView={{this.onChangeView}}
                @onChangeSort={{this.onChangeSort}}
                @handleSelect={{@handleSelect}}
                @onSubmit={{@onSubmit}}
                @multiSelect={{@multiSelect}}
                @selectedCards={{@selectedCards}}
                @onSelectAll={{@onSelectAll}}
                @onDeselectAll={{@onDeselectAll}}
                @adorn={{@adorn}}
                @adornStrokeClass={{adorn.strokeClass}}
                @adornPositionLabel={{adorn.positionLabel}}
              />
            </LiveRecentsProvider>
          </SearchResults>
        </SearchResults>
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
      /* Mini variant — tighten the layout so the chooser fits into a
         narrow side-by-side envelope. No top padding here: the results header
         below is sticky, and a top padding on the scroll container leaves a
         transparent band above the pinned header that scrolled rows bleed
         through. The header's own padding-block supplies its breathing room;
         keep the bottom padding for end-of-list room. */
      .search-sheet-content.mini {
        padding-block: 0 var(--boxel-sp-xs);
      }
      /* Pin the results header to the top of the .search-sheet-content
         scroll container so the "Searching…"/count indicator stays visible
         while the results scroll underneath it. The opaque background matches
         the container so scrolled cards are fully occluded, and z-index keeps
         it above the in-flow result sections. */
      .search-sheet-content.mini :deep(.search-result-header) {
        padding-block: var(--boxel-sp-xs);
        position: sticky;
        top: 0;
        z-index: 1;
        background-color: var(--boxel-light);
      }
      /* The summary is 16px bold in the full sheet; in the mini envelope drop
         it to the chooser's shared 14px scale (weight stays 600). */
      .search-sheet-content.mini :deep(.search-result-header .summary) {
        font: 600 var(--boxel-font-sm);
      }
      /* Summary + Sort sit on one row, with the Sort dropdown shrunk to
         fit its label rather than padded to a comfortable touch target. */
      .search-sheet-content.mini :deep(.search-result-header .controls) {
        gap: var(--boxel-sp-xs);
      }
      .search-sheet-content.mini :deep(.search-result-header .sort-button) {
        min-width: 0;
      }
    </style>
  </template>
}
