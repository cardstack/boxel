import { isDestroyed, isDestroying } from '@ember/destroyable';
import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import {
  type Filter,
  type ResolvedCodeRef,
  codeRefFromInternalKey,
  internalKeyFor,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  getBaseFilterTypeKeys,
  getFilterTypeRefs,
  getRootTypeKeys,
} from '../utils/card-search/type-filter';

import type NetworkService from '../services/network';
import type RealmServerService from '../services/realm-server';

/** Domain-level representation of a type option (no PickerOption dependency). */
export interface TypeOption {
  id: string; // internal key
  displayName: string;
  icon?: string;
}

type TypeSummaryItem = {
  id: string;
  type: string;
  attributes: { displayName: string; total: number; iconHTML: string };
  meta?: { realmURL: string };
};

export interface TypeSummariesArgs {
  named: {
    realmURLs: string[];
    baseFilter: Filter | undefined;
    initialSelectedTypes: ResolvedCodeRef[] | undefined;
    owner: Owner;
  };
}

export class TypeSummariesResource extends Resource<TypeSummariesArgs> {
  @service declare private network: NetworkService;
  @service declare private realmServer: RealmServerService;

  static PAGE_SIZE = 25;

  @tracked private _typeSummariesData: TypeSummaryItem[] = [];
  @tracked private _isLoading = false;
  @tracked private _isLoadingMore = false;
  @tracked private _hasMore = false;
  @tracked private _totalCount = 0;
  @tracked private _options: TypeOption[] = [];
  @tracked private _selected: ResolvedCodeRef[] = [];

  private _currentPage = 0;
  private _typeSearchKey = '';

  // Non-tracked: persists across resource re-runs without creating
  // tracking dependencies. Updated by updateSelected and recomputation.
  private _previousSelectedKeys: Set<string> = new Set();

  #previousRealmURLs: string[] | undefined;
  #baseFilter: Filter | undefined;
  #initialSelectedTypes: ResolvedCodeRef[] | undefined;

  constructor(owner: object) {
    super(owner);
    registerDestructor(this, () => {
      this.fetchTypeSummariesTask.cancelAll();
      this.loadMoreTypesTask.cancelAll();
    });
  }

  modify(_positional: never[], named: TypeSummariesArgs['named']) {
    let { realmURLs, baseFilter, initialSelectedTypes, owner } = named;
    setOwner(this, owner);

    this.#baseFilter = baseFilter;
    this.#initialSelectedTypes = initialSelectedTypes;

    // Only re-fetch when realmURLs change (search key changes are handled by onSearchChange)
    let realmURLsKey = realmURLs.join(',');
    let prevKey = this.#previousRealmURLs?.join(',');

    if (realmURLsKey !== prevKey) {
      this.#previousRealmURLs = realmURLs;
      this._typeSearchKey = '';
      this.fetchTypeSummariesTask.perform(realmURLs, '');
    }
  }

  // -- Public getters --

  get options(): TypeOption[] {
    return this._options;
  }

  get selected(): ResolvedCodeRef[] {
    return this._selected;
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  get isLoadingMore(): boolean {
    return this._isLoadingMore;
  }

  get hasMore(): boolean {
    return this._hasMore;
  }

  get totalCount(): number {
    return this._totalCount;
  }

  get hasNonRootBaseFilter(): boolean {
    return (
      getBaseFilterTypeKeys(this.#baseFilter, this.network.virtualNetwork) !==
      undefined
    );
  }

  // -- Public methods --

  onSearchChange(term: string): void {
    this._typeSearchKey = term;
    this.fetchTypeSummariesTask.perform(this.#previousRealmURLs ?? [], term);
  }

  onLoadMore(): void {
    if (this._isLoading || this._isLoadingMore || !this._hasMore) {
      return;
    }
    this.loadMoreTypesTask.perform();
  }

  updateSelected(selected: ResolvedCodeRef[]): void {
    this._previousSelectedKeys = new Set(
      selected.map((ref) =>
        internalKeyFor(ref, undefined, this.network.virtualNetwork),
      ),
    );
    this._selected = selected;
  }

  // -- Private helpers --

  /**
   * Guarded wrapper around realmServer.fetchCardTypeSummaries.
   * Returns undefined if the realm server can't fetch yet (matrix client not set),
   * or if the component is destroyed, or if the fetch fails.
   */
  private async fetchCardTypeSummaries(
    realmURLs: string[],
    options: {
      searchKey?: string;
      page: { number: number; size: number };
    },
  ) {
    if (!this.realmServer.canFetch) {
      return undefined;
    }
    try {
      let result = await this.realmServer.fetchCardTypeSummaries(
        realmURLs,
        options,
      );
      if (isDestroyed(this) || isDestroying(this)) return undefined;
      return result;
    } catch (e) {
      console.error('Failed to fetch card type summaries', e);
      return undefined;
    }
  }

  // -- Private tasks --

  private fetchTypeSummariesTask = restartableTask(
    async (realmURLs: string[], searchKey: string) => {
      if (searchKey) {
        await timeout(300); // debounce search
      } else {
        await Promise.resolve(); // yield to avoid autotracking assertion
      }
      if (isDestroyed(this) || isDestroying(this)) return;

      this._isLoading = true;
      this._currentPage = 0;

      let result = await this.fetchCardTypeSummaries(realmURLs, {
        searchKey: searchKey || undefined,
        page: { number: 0, size: TypeSummariesResource.PAGE_SIZE },
      });
      if (isDestroyed(this) || isDestroying(this)) return;
      if (!result) {
        this._isLoading = false;
        this._typeSummariesData = [];
        this._options = [];
        this._selected = [];
        this._hasMore = false;
        this._totalCount = 0;
        return;
      }

      this._typeSummariesData = result.data;
      this._totalCount = result.meta.page.total;
      this._hasMore = result.data.length < result.meta.page.total;

      // If there are selected types (or initialSelectedTypes) not yet in
      // the fetched results, keep fetching more pages until they're found.
      const selectedIds = new Set(this._previousSelectedKeys);
      const initialTypes = this.#initialSelectedTypes;
      if (initialTypes) {
        for (const ref of initialTypes) {
          selectedIds.add(
            internalKeyFor(ref, undefined, this.network.virtualNetwork),
          );
        }
      }

      if (selectedIds.size > 0 && this._hasMore) {
        while (this._hasMore) {
          const fetchedIds = new Set(this._typeSummariesData.map((d) => d.id));
          if ([...selectedIds].every((id) => fetchedIds.has(id))) break;

          const nextPage = this._currentPage + 1;
          let moreResult = await this.fetchCardTypeSummaries(realmURLs, {
            searchKey: searchKey || undefined,
            page: { number: nextPage, size: TypeSummariesResource.PAGE_SIZE },
          });
          if (isDestroyed(this) || isDestroying(this)) return;
          if (!moreResult) break;

          this._currentPage = nextPage;
          this._typeSummariesData = [
            ...this._typeSummariesData,
            ...moreResult.data,
          ];
          this._hasMore =
            this._typeSummariesData.length < moreResult.meta.page.total;
        }
      }

      this._isLoading = false;
      this.recomputeTypeFilter();
    },
  );

  private loadMoreTypesTask = restartableTask(async () => {
    if (isDestroyed(this) || isDestroying(this)) return;
    this._isLoadingMore = true;
    const nextPage = this._currentPage + 1;

    let result = await this.fetchCardTypeSummaries(
      this.#previousRealmURLs ?? [],
      {
        searchKey: this._typeSearchKey || undefined,
        page: { number: nextPage, size: TypeSummariesResource.PAGE_SIZE },
      },
    );
    if (isDestroyed(this) || isDestroying(this)) return;
    if (!result) {
      this._isLoadingMore = false;
      return;
    }

    this._currentPage = nextPage;
    this._typeSummariesData = [...this._typeSummariesData, ...result.data];
    const totalFetched = this._typeSummariesData.length;
    this._hasMore = totalFetched < result.meta.page.total;
    this._isLoadingMore = false;
    this.recomputeTypeFilter();
  });

  // -- Type filter computation --

  private recomputeTypeFilter(): void {
    const vn = this.network.virtualNetwork;
    const allowedCodeRefs = getBaseFilterTypeKeys(this.#baseFilter, vn);
    const rootTypeKeys = getRootTypeKeys(vn);
    const optionsById = new Map<string, TypeOption>();

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
        displayName: name,
        icon: item.attributes.iconHTML ?? undefined,
      });
    }

    this._options = [
      ...[...optionsById.values()].sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
    ];

    // Recalculate selected based on previous user selection.
    const prevKeys = this._previousSelectedKeys;
    const initialTypes = this.#initialSelectedTypes;
    const hadSelectAll = prevKeys.size === 0;

    if (initialTypes && initialTypes.length > 0 && prevKeys.size === 0) {
      // First launch with initialSelectedTypes (e.g., from "Find Instances").
      for (const ref of initialTypes) {
        if (
          ref.name === 'CardDef' &&
          ref.module === 'https://cardstack.com/base/card-api'
        ) {
          continue; // ignore CardDef from initialSelectedTypes since it's not a type that can be selected
        }
        this.selected.push(ref);
      }
    } else if (hadSelectAll) {
      // If baseFilter constrains to specific types and they exist in options,
      // auto-select them instead of defaulting to "Any Type"
      const baseTypeRefs = getFilterTypeRefs(this.#baseFilter);
      const baseRefs =
        baseTypeRefs
          ?.filter((r) => !r.negated && isResolvedCodeRef(r.ref))
          .map((r) =>
            internalKeyFor(r.ref, undefined, this.network.virtualNetwork),
          ) ?? [];
      if (baseRefs.length > 0) {
        const autoSelected = baseRefs
          .filter((ref) => optionsById.has(ref))
          .map((ref) => codeRefFromInternalKey(ref))
          .filter((ref): ref is ResolvedCodeRef => ref !== undefined);
        this._selected = autoSelected.length > 0 ? autoSelected : [];
      } else {
        this._selected = [];
      }
    } else if (this._isLoading || this._isLoadingMore) {
      // Type summaries still loading — keep previous selections
      // to avoid jarring UI changes. No change to _selected.
    } else {
      // Keep previous selections that still exist in the new options.
      const kept = [...prevKeys]
        .filter((key) => optionsById.has(key))
        .map((key) => codeRefFromInternalKey(key))
        .filter((ref): ref is ResolvedCodeRef => ref !== undefined);
      this._selected = kept.length > 0 ? kept : [];
    }

    this._previousSelectedKeys = new Set(
      this._selected.map((ref) =>
        internalKeyFor(ref, undefined, this.network.virtualNetwork),
      ),
    );
  }
}

export function getTypeSummaries(
  parent: object,
  owner: Owner,
  getArgs: () => {
    realmURLs: string[];
    baseFilter: Filter | undefined;
    initialSelectedTypes: ResolvedCodeRef[] | undefined;
  },
) {
  let resource = TypeSummariesResource.from(parent, () => ({
    named: {
      realmURLs: getArgs().realmURLs,
      baseFilter: getArgs().baseFilter,
      initialSelectedTypes: getArgs().initialSelectedTypes,
      owner,
    },
  }));
  return resource as TypeSummariesResource;
}
