import { isDestroyed, isDestroying } from '@ember/destroyable';
import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import { resource, use } from 'ember-resources';

import { TrackedObject } from 'tracked-built-ins';

import type { PickerOption } from '@cardstack/boxel-ui/components';

import {
  type Filter,
  type getCardCollection,
  CardContextName,
  GetCardCollectionContextName,
} from '@cardstack/runtime-common';

import {
  cardTypeDisplayName,
  cardTypeIcon,
} from '@cardstack/runtime-common/helpers/card-type-display-name';

import consumeContext from '@cardstack/host/helpers/consume-context';

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
  getSearchTerm,
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
  @tracked private recentCardCollection:
    | ReturnType<getCardCollection>
    | undefined;

  private getRecentCardCollection = () => {
    this.recentCardCollection = this.getCardCollection(
      this,
      () => this.recentCardsService.recentCardIds,
    );
  };

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

  private get searchTermFilteredRecentCards(): CardDef[] {
    const cards = this.baseFilteredRecentCards;
    const term = getSearchTerm(this.args.searchKey);
    if (!term) {
      return cards;
    }
    const lowerTerm = term.toLowerCase();
    return cards.filter((c) =>
      (c.cardTitle ?? '').toLowerCase().includes(lowerTerm),
    );
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

  @use private typeFilter = resource(() => {
    let value: { selected: PickerOption[]; options: PickerOption[] } =
      new TrackedObject({
        selected: [],
        options: [],
      });

    const seen = new Map<string, PickerOption>();

    // Derive types from search results (these have icons)
    for (const card of this.searchResource.instances) {
      const name = card.cardType;
      if (!name) {
        continue;
      }
      if (!seen.has(name)) {
        seen.set(name, {
          id: name,
          name,
          icon: card.iconHtml ?? undefined,
          type: 'option',
        });
      }
    }

    // Also derive types from recent cards so the picker has options
    // even when searchKey is blank and no search query runs.
    for (const card of this.searchTermFilteredRecentCards) {
      const name = cardTypeDisplayName(card);
      if (!name || seen.has(name)) {
        continue;
      }
      seen.set(name, {
        id: name,
        name,
        icon: cardTypeIcon(card),
        type: 'option',
      });
    }

    value.options = [
      ...[...seen.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ];

    // Recalculate selected based on previous user selection.
    // An empty array lets the Picker's ensureDefaultSelection() handle
    // selecting the built-in select-all option automatically.
    const prev = this._previousSelectedTypes;
    const hadSelectAll =
      prev.length === 0 || prev.some((opt) => opt.type === 'select-all');

    if (hadSelectAll) {
      value.selected = [];
    } else if (
      this.searchResource.instances.length === 0 &&
      this.args.searchKey?.trim()
    ) {
      // Active search but no results yet — keep previous selections to
      // avoid jarring UI changes. We check `seen.size` instead of
      // `searchResource.isLoading` to avoid reading the search task's
      // `isRunning`, which would cause a backtracking assertion.
      // When searchKey is blank, we fall through to the else branch
      // which naturally resets to [] (no valid options to intersect).
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
    {{consumeContext this.getRecentCardCollection}}
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
