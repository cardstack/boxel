import { isDestroyed, isDestroying } from '@ember/destroyable';
import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import { consume } from 'ember-provide-consume-context';

import { resource, use } from 'ember-resources';

import { TrackedObject } from 'tracked-built-ins';

import type { PickerOption } from '@cardstack/boxel-ui/components';

import {
  type Filter,
  type getCardCollection,
  baseCardRef,
  baseFieldRef,
  baseRef,
  CardContextName,
  GetCardCollectionContextName,
  internalKeyFor,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';

import { getPrerenderedSearch } from '@cardstack/host/resources/prerendered-search';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentCards from '@cardstack/host/services/recent-cards-service';

import type { CardContext, CardDef } from 'https://cardstack.com/base/card-api';

import { SORT_OPTIONS, type SortOption } from './constants';
import SearchBar from './search-bar';
import SearchContent from './search-content';
import {
  buildSearchQuery,
  filterCardsByTypeRefs,
  getFilterTypeRefs,
  shouldSkipSearchQuery,
} from './utils';

import type { WithBoundArgs } from '@glint/template';

const OWNER_DESTROYED_ERROR = 'OWNER_DESTROYED_ERROR';

type TypeSummaryItem = {
  id: string;
  type: string;
  attributes: { displayName: string; total: number; iconHTML: string };
  meta?: { realmURL: string };
};

interface Signature {
  Args: {
    searchKey: string;
    baseFilter?: Filter;
    availableRealmUrls?: string[];
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof SearchBar,
        | 'selectedRealms'
        | 'onRealmChange'
        | 'selectedTypes'
        | 'onTypeChange'
        | 'typeOptions'
        | 'onTypeSearchChange'
        | 'onLoadMoreTypes'
        | 'hasMoreTypes'
        | 'isLoadingTypes'
        | 'isLoadingMoreTypes'
        | 'typesTotalCount'
        | 'disableSelectAll'
      >,
      WithBoundArgs<
        typeof SearchContent,
        | 'searchKey'
        | 'selectedRealmURLs'
        | 'selectedCardTypes'
        | 'baseFilter'
        | 'skipTypeFiltering'
        | 'searchResource'
        | 'activeSort'
        | 'onSortChange'
        | 'filteredRecentCards'
      >,
      string,
    ];
  };
}

export default class SearchPanel extends Component<Signature> {
  @service declare private realmServer: RealmServerService;
  @service declare private recentCardsService: RecentCards;
  @consume(CardContextName) declare private cardContext:
    | CardContext
    | undefined;
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;

  @tracked private selectedRealms: PickerOption[] = [];
  @tracked private activeSort: SortOption = SORT_OPTIONS[0];

  // Type summaries state
  @tracked private _typeSearchKey = '';
  @tracked private _typeSummariesData: TypeSummaryItem[] = [];
  @tracked private _isLoadingTypes = false;
  @tracked private _isLoadingMoreTypes = false;
  @tracked private _hasMoreTypes = false;
  @tracked private _typesTotalCount = 0;

  @cached
  private get recentCardCollection(): ReturnType<getCardCollection> {
    return this.getCardCollection(
      this,
      () => this.recentCardsService.recentCardIds,
    );
  }

  // Non-tracked: persists across resource re-runs without creating
  // tracking dependencies. Updated by onTypeChange and the resource itself.
  private _previousSelectedTypes: PickerOption[] = [];

  private get selectedRealmURLs(): string[] {
    const hasSelectAll = this.selectedRealms.some(
      (opt) => opt.type === 'select-all',
    );
    if (hasSelectAll || this.selectedRealms.length === 0) {
      return (
        this.args.availableRealmUrls ?? this.realmServer.availableRealmURLs
      );
    }
    return this.selectedRealms.map((opt) => opt.id).filter(Boolean);
  }

  private get joinedSelectedRealmURLs(): string {
    return this.selectedRealmURLs.join(',');
  }

  private get baseFilteredRecentCards(): CardDef[] {
    const cards =
      (this.recentCardCollection?.cards?.filter(Boolean) as
        | CardDef[]
        | undefined) ?? [];
    const realmURLs = this.selectedRealmURLs;
    const realmFiltered = cards.filter(
      (c) => c.id && realmURLs.some((url) => c.id.startsWith(url)),
    );
    const typeRefs = getFilterTypeRefs(
      this.args.baseFilter,
      this.args.searchKey,
    );
    return filterCardsByTypeRefs(realmFiltered, typeRefs);
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

  @tracked private _currentPage = 0;
  static PAGE_SIZE = 25;

  private fetchTypeSummariesTask = restartableTask(
    async (realmURLs: string[], searchKey: string) => {
      if (searchKey) {
        await timeout(300); // debounce search
      } else {
        await Promise.resolve(); // yield to avoid autotracking assertion
      }
      if (isDestroyed(this) || isDestroying(this)) return;
      this._isLoadingTypes = true;
      this._currentPage = 0;

      try {
        let result = await this.realmServer.fetchCardTypeSummaries(realmURLs, {
          searchKey: searchKey || undefined,
          page: { number: 0, size: SearchPanel.PAGE_SIZE },
        });
        if (isDestroyed(this) || isDestroying(this)) return;

        this._typeSummariesData = result.data;
        this._typesTotalCount = result.meta.page.total;
        this._hasMoreTypes = result.data.length < result.meta.page.total;

        // If there are selected types not yet in the fetched results,
        // keep fetching more pages until they're all found (or no more pages).
        const selectedIds = new Set(
          this._previousSelectedTypes
            .filter((opt) => opt.type !== 'select-all')
            .map((opt) => opt.id),
        );

        if (selectedIds.size > 0 && this._hasMoreTypes) {
          while (this._hasMoreTypes) {
            const fetchedIds = new Set(
              this._typeSummariesData.map((d) => d.id),
            );
            if ([...selectedIds].every((id) => fetchedIds.has(id))) break;

            const nextPage = this._currentPage + 1;
            let moreResult = await this.realmServer.fetchCardTypeSummaries(
              realmURLs,
              {
                searchKey: searchKey || undefined,
                page: { number: nextPage, size: SearchPanel.PAGE_SIZE },
              },
            );
            if (isDestroyed(this) || isDestroying(this)) return;

            this._currentPage = nextPage;
            this._typeSummariesData = [
              ...this._typeSummariesData,
              ...moreResult.data,
            ];
            this._hasMoreTypes =
              this._typeSummariesData.length < moreResult.meta.page.total;
          }
        }

        this._isLoadingTypes = false;
      } catch (e) {
        console.error('Failed to fetch card type summaries', e);
        if (!isDestroyed(this) && !isDestroying(this)) {
          this._typeSummariesData = [];
          this._typesTotalCount = 0;
          this._hasMoreTypes = false;
          this._isLoadingTypes = false;
        }
      }
    },
  );

  // Resource that watches selectedRealmURLs and typeSearchKey to trigger fetches
  @use private _typeFetchTrigger = resource(() => {
    let realmURLs = this.selectedRealmURLs;
    let searchKey = this._typeSearchKey;

    this.fetchTypeSummariesTask.perform(realmURLs, searchKey);

    return { realmURLs, searchKey };
  });

  private get baseFilterCodeRefs(): Set<string> | undefined {
    const typeRefs = getFilterTypeRefs(this.args.baseFilter, '');
    if (!typeRefs || typeRefs.length === 0) {
      return undefined;
    }
    const refs = new Set<string>();
    for (const { ref, negated } of typeRefs) {
      if (!negated && isResolvedCodeRef(ref)) {
        refs.add(internalKeyFor(ref, undefined));
      }
    }
    if (refs.size === 0) return undefined;

    // CardDef/FieldDef are root types — all card types inherit from them,
    // so filtering by them would incorrectly show zero results. Skip.
    const baseKeys = new Set([
      internalKeyFor(baseCardRef, undefined),
      internalKeyFor(baseFieldRef, undefined),
      internalKeyFor(baseRef, undefined),
    ]);
    if ([...refs].every((r) => baseKeys.has(r))) {
      return undefined;
    }

    return refs;
  }

  private get hasNonRootBaseFilter(): boolean {
    return this.baseFilterCodeRefs !== undefined;
  }

  @use private typeFilter = resource(() => {
    // Access _typeFetchTrigger to ensure we re-run when fetch completes
    this._typeFetchTrigger;

    let value: { selected: PickerOption[]; options: PickerOption[] } =
      new TrackedObject({
        selected: [],
        options: [],
      });

    const allowedCodeRefs = this.baseFilterCodeRefs;
    const optionsById = new Map<string, PickerOption>();

    const rootTypeKeys = new Set([
      internalKeyFor(baseCardRef, undefined),
      internalKeyFor(baseFieldRef, undefined),
      internalKeyFor(baseRef, undefined),
    ]);

    for (const item of this._typeSummariesData) {
      const name = item.attributes.displayName;
      const codeRef = item.id;
      if (!name) {
        continue;
      }

      // Never show root types — they are internal meta types
      if (rootTypeKeys.has(codeRef)) {
        continue;
      }

      // When baseFilter constrains to specific types, only show matching types
      if (allowedCodeRefs && !allowedCodeRefs.has(codeRef)) {
        continue;
      }

      optionsById.set(codeRef, {
        id: codeRef,
        label: name,
        tooltip: codeRef,
        icon: item.attributes.iconHTML ?? undefined,
        type: 'option',
      });
    }

    value.options = [
      ...[...optionsById.values()].sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
    ];

    // Recalculate selected based on previous user selection.
    // An empty array lets the Picker's ensureDefaultSelection() handle
    // selecting the built-in select-all option automatically.
    const prev = this._previousSelectedTypes;
    const hadSelectAll =
      prev.length === 0 || prev.some((opt) => opt.type === 'select-all');

    if (hadSelectAll) {
      // If baseFilter constrains to specific types and they exist in options,
      // auto-select them instead of defaulting to "Any Type"
      const baseTypeRefs = getFilterTypeRefs(this.args.baseFilter, '');
      const baseRefs =
        baseTypeRefs
          ?.filter((r) => !r.negated && isResolvedCodeRef(r.ref))
          .map((r) => internalKeyFor(r.ref, undefined)) ?? [];
      if (baseRefs.length > 0) {
        const autoSelected = baseRefs
          .filter((ref) => optionsById.has(ref))
          .map((ref) => optionsById.get(ref)!);
        value.selected = autoSelected.length > 0 ? autoSelected : [];
      } else {
        value.selected = [];
      }
    } else if (this._isLoadingTypes || this._isLoadingMoreTypes) {
      // Type summaries still loading — keep previous selections
      // to avoid jarring UI changes.
      value.selected = prev;
    } else {
      // Keep previous selections that still exist in the new options,
      // mapping to new object references so Picker's isSelected (which
      // uses reference equality via lodash includes) works correctly.
      const kept = prev
        .filter((opt) => opt.type !== 'select-all' && optionsById.has(opt.id))
        .map((opt) => optionsById.get(opt.id)!);
      value.selected = kept.length > 0 ? kept : [];
    }

    this._previousSelectedTypes = value.selected;
    return value;
  });

  private searchResource = getPrerenderedSearch(this, getOwner(this)!, () => {
    // Consume typeFilter.selected outside the ternary so the tracking
    // dependency is always established, even when the query is skipped.
    const selectedTypeIds = this.typeFilter.selected.map((opt) => opt.id);
    return {
      query: shouldSkipSearchQuery(this.args.searchKey, this.args.baseFilter)
        ? undefined
        : buildSearchQuery(
            this.args.searchKey,
            this.activeSort,
            this.args.baseFilter,
            selectedTypeIds,
          ),
      format: 'fitted' as const,
      realms: this.selectedRealmURLs,
      isLive: true,
      cardComponentModifier: this.cardComponentModifier,
    };
  });

  @action
  private onRealmChange(selected: PickerOption[]) {
    this.selectedRealms = selected;
  }

  @action
  private onTypeChange(selected: PickerOption[]) {
    this._previousSelectedTypes = selected;
    this.typeFilter.selected = selected;
  }

  @action
  private onSortChange(option: SortOption) {
    this.activeSort = option;
  }

  @action
  private onTypeSearchChange(term: string) {
    this._typeSearchKey = term;
    this.fetchTypeSummariesTask.perform(this.selectedRealmURLs, term);
  }

  private loadMoreTypesTask = restartableTask(async () => {
    if (isDestroyed(this) || isDestroying(this)) return;
    this._isLoadingMoreTypes = true;
    const nextPage = this._currentPage + 1;

    try {
      let result = await this.realmServer.fetchCardTypeSummaries(
        this.selectedRealmURLs,
        {
          searchKey: this._typeSearchKey || undefined,
          page: { number: nextPage, size: SearchPanel.PAGE_SIZE },
        },
      );
      if (isDestroyed(this) || isDestroying(this)) return;

      this._currentPage = nextPage;
      this._typeSummariesData = [...this._typeSummariesData, ...result.data];
      const totalFetched = this._typeSummariesData.length;
      this._hasMoreTypes = totalFetched < result.meta.page.total;
      this._isLoadingMoreTypes = false;
    } catch (e) {
      console.error('Failed to load more card type summaries', e);
      if (!isDestroyed(this) && !isDestroying(this)) {
        this._isLoadingMoreTypes = false;
      }
    }
  });

  @action
  private onLoadMoreTypes() {
    if (
      this._isLoadingTypes ||
      this._isLoadingMoreTypes ||
      !this._hasMoreTypes
    ) {
      return;
    }
    this.loadMoreTypesTask.perform();
  }

  <template>
    {{yield
      (component
        SearchBar
        selectedRealms=this.selectedRealms
        onRealmChange=this.onRealmChange
        selectedTypes=this.typeFilter.selected
        onTypeChange=this.onTypeChange
        typeOptions=this.typeFilter.options
        onTypeSearchChange=this.onTypeSearchChange
        onLoadMoreTypes=this.onLoadMoreTypes
        hasMoreTypes=this._hasMoreTypes
        isLoadingTypes=this._isLoadingTypes
        isLoadingMoreTypes=this._isLoadingMoreTypes
        typesTotalCount=this._typesTotalCount
        disableSelectAll=this.hasNonRootBaseFilter
      )
      (component
        SearchContent
        searchKey=@searchKey
        selectedRealmURLs=this.selectedRealmURLs
        selectedCardTypes=this.typeFilter.selected
        baseFilter=@baseFilter
        skipTypeFiltering=this.hasNonRootBaseFilter
        searchResource=this.searchResource
        activeSort=this.activeSort
        onSortChange=this.onSortChange
        filteredRecentCards=this.baseFilteredRecentCards
      )
      this.joinedSelectedRealmURLs
    }}
  </template>
}
