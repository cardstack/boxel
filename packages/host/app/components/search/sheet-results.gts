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

import type { SectionPagination } from '@cardstack/host/utils/search/section-pagination';
import {
  assembleSections,
  buildLiveRecentsSection,
  buildQuerySections,
  buildRecentsSection,
  buildUrlSection,
  type RecentsSection,
  type SearchSheetSection,
  type UrlSection,
} from '@cardstack/host/utils/search/sections';
import type {
  NewCardArgs,
  SearchResultKind,
} from '@cardstack/host/utils/search/types';

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
    // True when `realms` is a hard scope (the chooser's realm picker is
    // locked). A pasted URL that resolves outside the scope is then
    // suppressed rather than offered.
    realmsLocked?: boolean;
    // Every realm this search may draw from, before the realm picker narrows
    // it. `realms` is a user-chosen slice of this; a pasted URL outside it is
    // outside the caller's reach entirely, so it is suppressed even though
    // the picker stays open. Omitted when the caller imposes no such bound.
    availableRealms?: string[];
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
    handleSelect: (
      selection: string | NewCardArgs,
      kind?: SearchResultKind,
    ) => void;
    onSubmit?: (
      selection: string | NewCardArgs,
      kind?: SearchResultKind,
    ) => void;
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

  // The URL-paste section. A pasted URL that resolves to a card outside the
  // scope its caller imposes is suppressed — otherwise the tile would be
  // selectable and Go could return a card the caller cannot use. Two bounds
  // do that, each checked against the realm `buildUrlSection` resolved (it
  // matches `realms` first, normalizing id forms, and falls back to the
  // card's own realm when none matches): a locked realm scope, which pins the
  // paste to `realms`, and `availableRealms`, the realms the caller can draw
  // from at all — the realm picker only ever narrows that set, so a paste
  // outside it is out of reach however the picker is set. A caller that
  // imposes neither accepts any URL the user can resolve.
  private get urlSection(): UrlSection | undefined {
    let section = buildUrlSection(
      this.args.resolvedCard,
      this.args.searchKeyIsURL,
      this.urlSectionRealms,
      this.realm,
      (url) => this.network.virtualNetwork.unresolveURL(url),
    );
    if (!section) {
      return undefined;
    }
    if (
      this.args.realmsLocked &&
      !this.args.realms.includes(section.realmUrl)
    ) {
      return undefined;
    }
    if (
      this.args.availableRealms &&
      !this.urlSectionRealms.includes(section.realmUrl)
    ) {
      return undefined;
    }
    return section;
  }

  // Realms `buildUrlSection` matches the pasted card against, picked realms
  // first so a card in one resolves to the picked form. A card in an
  // available-but-unpicked realm would otherwise fall to the path-derived
  // realm, which names a sub-path rather than a realm root and so reads as
  // out of scope; carrying every available realm resolves it verbatim
  // instead, leaving the fallback to mean what the scope check takes it to
  // mean — the card is in none of these realms.
  private get urlSectionRealms(): string[] {
    if (!this.args.availableRealms) {
      return this.args.realms;
    }
    return [...new Set([...this.args.realms, ...this.args.availableRealms])];
  }

  private get sections(): SearchSheetSection[] {
    return assembleSections(
      this.recentsSection,
      this.urlSection,
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
      // Count the section, not the resolved card — a card suppressed by the
      // locked realm scope must not be reported as a result.
      return this.urlSection ? '1 result from 1 realm' : '0 results';
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
    if (this.urlSection?.card.id) {
      urls.push(this.urlSection.card.id.replace(/\.json$/, ''));
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

  @action isSectionCollapsed(section: SearchSheetSection): boolean {
    // A pasted URL is an explicit ask for that one card. A focused
    // ("show only") realm section — including the one seeded when the
    // chooser is scoped to a consuming realm — must not hide it: during a
    // URL paste the realm query sections aren't rendered at all, so
    // collapsing the URL section would leave the result count with
    // nothing visible under it.
    if (section.type === 'url') {
      return false;
    }
    return this.args.pagination.isCollapsed(section.sid);
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
        {{#unless this.urlSection}}
          <div class='empty-state' data-test-search-sheet-empty>
            {{#if @resolvedCard}}
              {{! The card exists but the locked realm scope excludes it —
                  saying "no card found" here would be untrue and send the
                  user hunting for a typo. }}
              Card at
              {{@searchKey}}
              is not in the realms this chooser is limited to
            {{else}}
              No card found at
              {{@searchKey}}
            {{/if}}
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
          @isCollapsed={{this.isSectionCollapsed section}}
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
