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
  baseCardRef,
  baseFieldRef,
  baseRef,
  codeRefFromInternalKey,
  internalKeyFor,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  getFilterTypeRefs,
} from '../components/card-search/utils';

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

const ROOT_TYPE_KEYS = new Set([
  internalKeyFor(baseCardRef, undefined),
  internalKeyFor(baseFieldRef, undefined),
  internalKeyFor(baseRef, undefined),
]);

export class TypeSummariesResource extends Resource<TypeSummariesArgs> {
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
    return this.baseFilterCodeRefs !== undefined;
  }

  get selectedTypeIds(): string[] {
    return this._selected.map((ref) => internalKeyFor(ref, undefined));
  }

  // -- Public methods --

  onSearchChange(term: string): void {
    this._typeSearchKey = term;
    this.fetchTypeSummariesTask.perform(
      this.#previousRealmURLs ?? [],
      term,
    );
  }

  onLoadMore(): void {
    if (this._isLoading || this._isLoadingMore || !this._hasMore) {
      return;
    }
    this.loadMoreTypesTask.perform();
  }

  updateSelected(selected: ResolvedCodeRef[]): void {
    this._previousSelectedKeys = new Set(
      selected.map((ref) => internalKeyFor(ref, undefined)),
    );
    this._selected = selected;
  }

  // -- Private computed --

  private get baseFilterCodeRefs(): Set<string> | undefined {
    const typeRefs = getFilterTypeRefs(this.#baseFilter);
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
    if ([...refs].every((r) => ROOT_TYPE_KEYS.has(r))) {
      return undefined;
    }

    return refs;
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

      try {
        let result = await this.realmServer.fetchCardTypeSummaries(realmURLs, {
          searchKey: searchKey || undefined,
          page: {
            number: 0,
            size: TypeSummariesResource.PAGE_SIZE,
          },
        });
        if (isDestroyed(this) || isDestroying(this)) return;

        this._typeSummariesData = result.data;
        this._totalCount = result.meta.page.total;
        this._hasMore = result.data.length < result.meta.page.total;

        // If there are selected types (or initialSelectedTypes) not yet in
        // the fetched results, keep fetching more pages until they're found.
        const selectedIds = new Set(this._previousSelectedKeys);
        const initialTypes = this.#initialSelectedTypes;
        if (initialTypes) {
          for (const ref of initialTypes) {
            selectedIds.add(internalKeyFor(ref, undefined));
          }
        }

        if (selectedIds.size > 0 && this._hasMore) {
          while (this._hasMore) {
            const fetchedIds = new Set(
              this._typeSummariesData.map((d) => d.id),
            );
            if ([...selectedIds].every((id) => fetchedIds.has(id))) break;

            const nextPage = this._currentPage + 1;
            let moreResult = await this.realmServer.fetchCardTypeSummaries(
              realmURLs,
              {
                searchKey: searchKey || undefined,
                page: {
                  number: nextPage,
                  size: TypeSummariesResource.PAGE_SIZE,
                },
              },
            );
            if (isDestroyed(this) || isDestroying(this)) return;

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
      } catch (e) {
        console.error('Failed to fetch card type summaries', e);
        if (!isDestroyed(this) && !isDestroying(this)) {
          this._typeSummariesData = [];
          this._totalCount = 0;
          this._hasMore = false;
          this._isLoading = false;
          this.recomputeTypeFilter();
        }
      }
    },
  );

  private loadMoreTypesTask = restartableTask(async () => {
    if (isDestroyed(this) || isDestroying(this)) return;
    this._isLoadingMore = true;
    const nextPage = this._currentPage + 1;

    try {
      let result = await this.realmServer.fetchCardTypeSummaries(
        this.#previousRealmURLs ?? [],
        {
          searchKey: this._typeSearchKey || undefined,
          page: {
            number: nextPage,
            size: TypeSummariesResource.PAGE_SIZE,
          },
        },
      );
      if (isDestroyed(this) || isDestroying(this)) return;

      this._currentPage = nextPage;
      this._typeSummariesData = [...this._typeSummariesData, ...result.data];
      const totalFetched = this._typeSummariesData.length;
      this._hasMore = totalFetched < result.meta.page.total;
      this._isLoadingMore = false;
      this.recomputeTypeFilter();
    } catch (e) {
      console.error('Failed to load more card type summaries', e);
      if (!isDestroyed(this) && !isDestroying(this)) {
        this._isLoadingMore = false;
      }
    }
  });

  // -- Type filter computation --

  private recomputeTypeFilter(): void {
    const allowedCodeRefs = this.baseFilterCodeRefs;
    const optionsById = new Map<string, TypeOption>();

    for (const item of this._typeSummariesData) {
      const name = item.attributes.displayName;
      const codeRef = item.id;
      if (!name) {
        continue;
      }

      // Never show root types — they are internal meta types
      if (ROOT_TYPE_KEYS.has(codeRef)) {
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
      this._selected = [...initialTypes];
    } else if (hadSelectAll) {
      // If baseFilter constrains to specific types and they exist in options,
      // auto-select them instead of defaulting to "Any Type"
      const baseTypeRefs = getFilterTypeRefs(this.#baseFilter);
      const baseRefs =
        baseTypeRefs
          ?.filter((r) => !r.negated && isResolvedCodeRef(r.ref))
          .map((r) => internalKeyFor(r.ref, undefined)) ?? [];
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
      this._selected.map((ref) => internalKeyFor(ref, undefined)),
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
