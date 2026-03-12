import { isDestroyed, isDestroying } from '@ember/destroyable';
import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import { resource, use } from 'ember-resources';

import { TrackedObject } from 'tracked-built-ins';

import type { PickerOption } from '@cardstack/boxel-ui/components';

import {
  type Filter,
  type getCardCollection,
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
      >,
      WithBoundArgs<
        typeof SearchContent,
        | 'searchKey'
        | 'selectedRealmURLs'
        | 'selectedCardTypes'
        | 'typeCodeRefs'
        | 'baseFilter'
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

  // Stores code_ref mappings for each display name (multiple code_refs
  // can map to the same display name, e.g. different modules with the same card type name).
  private _typeCodeRefs = new Map<string, string[]>();

  @use private cardTypeSummaries = resource(() => {
    // Track selectedRealmURLs so we re-fetch when realms change
    let realmURLs = this.selectedRealmURLs;
    let state: {
      data: {
        id: string;
        type: string;
        attributes: { displayName: string; total: number; iconHTML: string };
      }[];
      isLoading: boolean;
    } = new TrackedObject({ data: [], isLoading: true });

    (async () => {
      try {
        let result = await this.realmServer.fetchCardTypeSummaries(realmURLs);
        if (!isDestroyed(this) && !isDestroying(this)) {
          state.data = result.data;
          state.isLoading = false;
        }
      } catch (e) {
        console.error('Failed to fetch card type summaries', e);
        if (!isDestroyed(this) && !isDestroying(this)) {
          state.data = [];
          state.isLoading = false;
        }
      }
    })();

    return state;
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
    return refs.size > 0 ? refs : undefined;
  }

  @use private typeFilter = resource(() => {
    let value: { selected: PickerOption[]; options: PickerOption[] } =
      new TrackedObject({
        selected: [],
        options: [],
      });

    const seen = new Map<string, PickerOption>();
    const codeRefsByDisplayName = new Map<string, string[]>();
    const allowedCodeRefs = this.baseFilterCodeRefs;

    for (const item of this.cardTypeSummaries.data) {
      const name = item.attributes.displayName;
      const codeRef = item.id;
      if (!name) {
        continue;
      }

      // When baseFilter constrains to specific types, only show matching types
      if (allowedCodeRefs && !allowedCodeRefs.has(codeRef)) {
        continue;
      }

      if (!codeRefsByDisplayName.has(name)) {
        codeRefsByDisplayName.set(name, []);
      }
      codeRefsByDisplayName.get(name)!.push(codeRef);

      if (!seen.has(name)) {
        seen.set(name, {
          id: name,
          label: name,
          icon: item.attributes.iconHTML ?? undefined,
          type: 'option',
        });
      }
    }

    this._typeCodeRefs = codeRefsByDisplayName;

    value.options = [
      ...[...seen.values()].sort((a, b) => a.label.localeCompare(b.label)),
    ];

    // Recalculate selected based on previous user selection.
    // An empty array lets the Picker's ensureDefaultSelection() handle
    // selecting the built-in select-all option automatically.
    const prev = this._previousSelectedTypes;
    const hadSelectAll =
      prev.length === 0 || prev.some((opt) => opt.type === 'select-all');

    if (hadSelectAll) {
      value.selected = [];
    } else if (this.cardTypeSummaries.isLoading) {
      // Type summaries still loading — keep previous selections
      // to avoid jarring UI changes.
      value.selected = prev;
    } else {
      // Keep previous selections that still exist in the new options,
      // mapping to new object references so Picker's isSelected (which
      // uses reference equality via lodash includes) works correctly.
      const validIds = new Set(seen.keys());
      const kept = prev
        .filter((opt) => opt.type !== 'select-all' && validIds.has(opt.id))
        .map((opt) => seen.get(opt.id)!);
      value.selected = kept.length > 0 ? kept : [];
    }

    this._previousSelectedTypes = value.selected;
    return value;
  });

  private searchResource = getPrerenderedSearch(this, getOwner(this)!, () => ({
    query: shouldSkipSearchQuery(this.args.searchKey, this.args.baseFilter)
      ? undefined
      : buildSearchQuery(
          this.args.searchKey,
          this.activeSort,
          this.args.baseFilter,
        ),
    format: 'fitted' as const,
    realms: this.selectedRealmURLs,
    isLive: true,
    cardComponentModifier: this.cardComponentModifier,
  }));

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

  <template>
    {{yield
      (component
        SearchBar
        selectedRealms=this.selectedRealms
        onRealmChange=this.onRealmChange
        selectedTypes=this.typeFilter.selected
        onTypeChange=this.onTypeChange
        typeOptions=this.typeFilter.options
      )
      (component
        SearchContent
        searchKey=@searchKey
        selectedRealmURLs=this.selectedRealmURLs
        selectedCardTypes=this.typeFilter.selected
        typeCodeRefs=this._typeCodeRefs
        baseFilter=@baseFilter
        searchResource=this.searchResource
        activeSort=this.activeSort
        onSortChange=this.onSortChange
        filteredRecentCards=this.baseFilteredRecentCards
      )
      this.joinedSelectedRealmURLs
    }}
  </template>
}
