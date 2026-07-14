import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import pluralize from 'pluralize';

import { eq } from '@cardstack/boxel-ui/helpers';

import type {
  CodeRef,
  Filter,
  RenderableSearchEntryLike,
  SearchResultsYield,
} from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';

import type { SectionPagination } from '@cardstack/host/utils/card-search/section-pagination';
import {
  assembleSections,
  buildLiveRecentsSection,
  buildQuerySections,
  buildRecentsSection,
  buildUrlSection,
  type RecentsSection,
  type SearchSheetSection,
} from '@cardstack/host/utils/card-search/sections';
import type { NewCardArgs } from '@cardstack/host/utils/card-search/types';

import { SORT_OPTIONS, VIEW_OPTIONS, type SortOption } from './constants';
import ResultSection from './result-section';
import SearchResultHeader from './search-result-header';

import type { CardDef } from '@cardstack/base/card-api';

import type { ModifierLike } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    // The yielded results from the realm-search and recents `<SearchResults>`,
    // plus the live-recents fallback cards (non-empty only when the recents
    // search threw). The section / count / multiselect derivations read these
    // through getters, so no `<SearchResults>`-yielded param is fed into an
    // in-template helper call.
    mainResults: SearchResultsYield;
    recentsResults: SearchResultsYield;
    liveRecentCards: CardDef[];

    isCompact: boolean;
    showHeader: boolean;
    // Opt-in visual variant. 'mini' compresses the summary, hides the view
    // picker + per-section "show only" toggle, and forces single-line rows.
    variant?: 'default' | 'mini';

    // Search-key / URL-paste state, resolved by the parent.
    searchKey: string;
    searchKeyIsURL: boolean;
    isSearchKeyEmpty: boolean;
    shouldSkipQuery: boolean;
    resolvedCard: CardDef | undefined;
    isCardResourceLoaded: boolean;
    realms: string[];
    baseFilter?: Filter;
    offerToCreate?: { ref: CodeRef; relativeTo: URL | undefined };
    // The recent card ids stripped of any `.json`, for most-recent-first
    // ordering of the compact recents row against the bare `entry.id`.
    recentCardBareIds: string[];
    // Shared pagination/focus state (Show More / Show Only) owned by the parent.
    pagination: SectionPagination;

    // Header controls.
    activeViewId: string;
    activeSort: SortOption;
    onChangeView: (id: string) => void;
    onChangeSort: (option: SortOption) => void;

    // Selection + submit.
    handleSelect: (selection: string | NewCardArgs) => void;
    onSubmit?: (selection: string | NewCardArgs) => void;
    multiSelect?: boolean;
    selectedCards?: (string | NewCardArgs)[];
    onSelectAll?: (cards: string[]) => void;
    onDeselectAll?: () => void;

    // Adorn treatment, threaded from the parent's <AdornContext>.
    adorn?: boolean;
    adornStrokeClass?: string;
    adornPositionLabel?: ModifierLike<{
      Element: HTMLElement;
      Args: { Positional: [cardEl: HTMLElement | undefined] };
    }>;
  };
  Blocks: {};
}

// Lays the heterogeneous `entry` stream from `<SearchResults>` out into
// the search sheet's realm / recents / URL-paste sections, with the header,
// multiselect, the Adorn treatment, pagination, and the result count expressed
// here at the call site over the yielded entries. Every derivation is a getter
// reading the yielded results passed in as args, so the view stays reactive
// without a parallel search resource.
export default class SheetResults extends Component<Signature> {
  @service declare private realm: RealmService;
  @service declare private network: NetworkService;

  VIEW_OPTIONS = VIEW_OPTIONS;
  SORT_OPTIONS = SORT_OPTIONS;

  // The recents row, from the live fallback when the prerendered recents search
  // threw, else the prerendered entries. Compact mode reorders to
  // most-recent-first; full mode keeps the server's sort/filter order.
  private get recentsSection(): RecentsSection | undefined {
    if (this.args.liveRecentCards.length > 0) {
      return buildLiveRecentsSection(this.args.liveRecentCards);
    }
    const entries = this.args.recentsResults.entries;
    if (this.args.isCompact) {
      let byId = new Map<string, RenderableSearchEntryLike>();
      for (let entry of entries) {
        byId.set(entry.id, entry);
      }
      let ordered = this.args.recentCardBareIds
        .map((id) => byId.get(id))
        .filter((e): e is RenderableSearchEntryLike => e !== undefined);
      return buildRecentsSection(ordered);
    }
    return buildRecentsSection([...entries]);
  }

  private get sections(): SearchSheetSection[] {
    return assembleSections(
      this.recentsSection,
      buildUrlSection(
        this.args.resolvedCard,
        this.args.searchKeyIsURL,
        this.args.realms,
        this.realm,
        (url) => this.network.virtualNetwork.unresolveURL(url),
      ),
      buildQuerySections(this.args.mainResults.entries, {
        isURL: this.args.searchKeyIsURL,
        isSearchKeyEmpty: this.args.isSearchKeyEmpty,
        hasBaseFilter: !!this.args.baseFilter,
        realmURLs: this.args.realms,
        offerToCreate: this.args.offerToCreate,
        realm: this.realm,
      }),
      this.args.pagination.focusedSection,
    );
  }

  private get summaryText(): string {
    if (this.args.isCompact) {
      return '';
    }
    if (this.args.mainResults.isLoading) {
      return 'Searching…';
    }
    if (this.args.searchKeyIsURL) {
      if (!this.args.isCardResourceLoaded) {
        return 'Searching…';
      }
      return this.args.resolvedCard ? '1 result from 1 realm' : '0 results';
    }
    const total = this.args.mainResults.meta.page?.total ?? 0;
    // The mini variant compresses the summary to "X results" — the design puts
    // it next to the Sort dropdown on a single row, with no room for the
    // across-realms qualifier.
    if (this.args.variant === 'mini') {
      return pluralize('result', total, true);
    }
    return `${pluralize('result', total, true)} across ${pluralize('realm', this.args.realms.length, true)}`;
  }

  // Under @variant='mini' the section view id is forced to the internal 'mini'
  // literal regardless of activeViewId, so the (hidden) view picker can't fight
  // the consumer.
  private get displayedViewId(): string {
    return this.args.variant === 'mini' ? 'mini' : this.args.activeViewId;
  }

  private get allCards(): string[] {
    const urls: string[] = [];
    for (const entry of this.args.mainResults.entries) {
      if (entry.id) {
        urls.push(entry.id.replace(/\.json$/, ''));
      }
    }
    if (this.args.liveRecentCards.length > 0) {
      for (const card of this.args.liveRecentCards) {
        if (card?.id) {
          urls.push(card.id.replace(/\.json$/, ''));
        }
      }
    } else {
      for (const entry of this.args.recentsResults.entries) {
        urls.push(entry.id.replace(/\.json$/, ''));
      }
    }
    if (this.args.resolvedCard?.id) {
      urls.push(this.args.resolvedCard.id.replace(/\.json$/, ''));
    }
    return [...new Set(urls)];
  }

  // The global summary + Sort row. Hidden in the mini chooser's default
  // Recents view (empty search): there the Recents section supplies its own
  // header (label + count), and the design shows no Sort control until the
  // user actually searches. Unaffected for the full search sheet.
  private get showGlobalHeader(): boolean {
    if (!this.args.showHeader || this.args.isCompact) {
      return false;
    }
    if (this.args.variant === 'mini' && this.args.isSearchKeyEmpty) {
      return false;
    }
    return true;
  }

  private get hasNoResults(): boolean {
    return (
      this.sections.length === 0 &&
      !this.args.mainResults.isLoading &&
      !this.args.shouldSkipQuery
    );
  }

  getDisplayedCount = (sectionId: string, totalCount: number): number => {
    return this.args.pagination.getDisplayedCount(sectionId, totalCount);
  };

  @action onFocusSection(sectionId: string | null) {
    this.args.pagination.focus(sectionId);
  }

  @action onShowMore(sectionId: string, totalCount: number) {
    this.args.pagination.showMore(sectionId, totalCount);
  }

  @action isSectionCollapsed(sectionId: string): boolean {
    return this.args.pagination.isCollapsed(sectionId);
  }

  <template>
    {{#if this.showGlobalHeader}}
      <SearchResultHeader
        @summaryText={{this.summaryText}}
        @viewOptions={{this.VIEW_OPTIONS}}
        @activeViewId={{@activeViewId}}
        @activeSort={{@activeSort}}
        @sortOptions={{this.SORT_OPTIONS}}
        @onChangeView={{@onChangeView}}
        @onChangeSort={{@onChangeSort}}
        @multiSelect={{@multiSelect}}
        @selectedCards={{@selectedCards}}
        @allCards={{this.allCards}}
        @onSelectAll={{@onSelectAll}}
        @onDeselectAll={{@onDeselectAll}}
        @hideViewSelector={{eq @variant 'mini'}}
      />
    {{/if}}

    {{! Handle empty URL search state — only after loading completes }}
    {{#if @searchKeyIsURL}}
      {{#if @isCardResourceLoaded}}
        {{#unless @resolvedCard}}
          <div class='empty-state' data-test-search-sheet-empty>
            No card found at
            {{@searchKey}}
          </div>
        {{/unless}}
      {{/if}}
    {{/if}}

    {{#if @isCompact}}
      {{#if this.recentsSection}}
        <ResultSection
          @section={{this.recentsSection}}
          @isCompact={{true}}
          @handleSelect={{@handleSelect}}
          @adorn={{@adorn}}
          @adornStrokeClass={{@adornStrokeClass}}
          @adornPositionLabel={{@adornPositionLabel}}
          data-test-search-result-section='recent-cards'
        />
      {{/if}}
    {{else}}
      {{#each this.sections key='sid' as |section i|}}
        <ResultSection
          @section={{section}}
          @viewOption={{this.displayedViewId}}
          @variant={{@variant}}
          @handleSelect={{@handleSelect}}
          @isFocused={{eq @pagination.focusedSection section.sid}}
          @isCollapsed={{this.isSectionCollapsed section.sid}}
          @onFocusSection={{this.onFocusSection}}
          @getDisplayedCount={{this.getDisplayedCount}}
          @onShowMore={{this.onShowMore}}
          @selectedCards={{@selectedCards}}
          @multiSelect={{@multiSelect}}
          @offerToCreate={{@offerToCreate}}
          @onSubmit={{@onSubmit}}
          @adorn={{@adorn}}
          @adornStrokeClass={{@adornStrokeClass}}
          @adornPositionLabel={{@adornPositionLabel}}
          data-section-sid={{section.sid}}
          data-test-search-result-section={{i}}
        />
      {{/each}}

      {{#if this.hasNoResults}}
        <div class='empty-state' data-test-search-content-empty>
          No results found
        </div>
      {{/if}}
    {{/if}}
    <style scoped>
      .empty-state {
        padding-block: var(--boxel-sp);
      }
    </style>
  </template>
}
