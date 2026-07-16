import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import type { Filter, ResolvedCodeRef } from '@cardstack/runtime-common';

import type { RealmFilter } from '@cardstack/host/components/realm-picker';
import type { TypeFilter } from '@cardstack/host/components/type-picker';
import { getTypeSummaries } from '@cardstack/host/resources/type-summaries';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { SORT_OPTIONS, type SortOption } from './constants';
import PanelContent from './panel-content';
import SearchBar from './search-bar';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Args: {
    searchKey: string;
    baseFilter?: Filter;
    initialSelectedTypes?: ResolvedCodeRef[];
    initialSelectedRealms?: URL[];
    /**
     * Hard-scope: when true, selectedRealms is fixed to initialSelectedRealms
     * and the realm picker is disabled.
     */
    lockSelectedRealms?: boolean;
    // A cards-only chooser: the type picker offers card types only (file types
    // are hidden so one can't be selected against the card scope).
    cardsOnly?: boolean;
    onRealmChange?: (selectedRealms: URL[]) => void;
    onTypeChange?: (selectedTypes: ResolvedCodeRef[]) => void;
  };
  Blocks: {
    default: [
      WithBoundArgs<typeof SearchBar, 'value' | 'realmFilter' | 'typeFilter'>,
      WithBoundArgs<
        typeof PanelContent,
        | 'searchKey'
        | 'realmFilter'
        | 'typeFilter'
        | 'baseFilter'
        | 'activeSort'
        | 'onSortChange'
        | 'initialFocusedSection'
      >,
    ];
  };
}

export default class SearchPanel extends Component<Signature> {
  @service declare private realmServer: RealmServerService;

  @tracked private selectedRealms: URL[] =
    this.args.initialSelectedRealms ?? [];
  @tracked private activeSort: SortOption = SORT_OPTIONS[0];

  private typeSummaries = getTypeSummaries(this, getOwner(this)!, () => ({
    realmURLs: this.selectedRealmURLs,
    baseFilter: this.args.baseFilter,
    initialSelectedTypes: this.args.initialSelectedTypes,
    cardsOnly: this.args.cardsOnly,
  }));

  private get initialFocusedSectionId(): string | null {
    let realmURLs = this.args.initialSelectedRealms;
    if (!realmURLs || realmURLs.length === 0) {
      return null;
    }
    return `realm:${realmURLs[0].href}`;
  }

  private get selectedRealmURLs(): string[] {
    if (this.selectedRealms.length === 0) {
      return this.realmServer.availableRealmIdentifiers;
    }
    return this.selectedRealms.map((url) => url.href);
  }

  // -- Filter objects --

  private get realmFilter(): RealmFilter {
    return {
      selected: this.selectedRealms,
      onChange: this.onRealmChange,
      selectedURLs: this.selectedRealmURLs,
      locked: this.args.lockSelectedRealms,
    };
  }

  private get typeFilter(): TypeFilter {
    let ts = this.typeSummaries;
    return {
      options: ts.options,
      selected: ts.selected,
      onChange: this.onTypeChange,
      onSearchChange: this.onTypeSearchChange,
      onLoadMore: this.onLoadMoreTypes,
      hasMore: ts.hasMore,
      isLoading: ts.isLoading,
      isLoadingMore: ts.isLoadingMore,
      totalCount: ts.totalCount,
      disableSelectAll: ts.hasNonRootBaseFilter,
      skipTypeFiltering: ts.hasNonRootBaseFilter,
    };
  }

  // -- Actions --

  @action
  private onRealmChange(selected: URL[]) {
    if (this.args.lockSelectedRealms) {
      return;
    }
    this.selectedRealms = selected;
    this.args.onRealmChange?.(selected);
  }

  @action
  private onTypeChange(selected: ResolvedCodeRef[]) {
    this.typeSummaries.updateSelected(selected);
    this.args.onTypeChange?.(selected);
  }

  @action
  private onSortChange(option: SortOption) {
    this.activeSort = option;
  }

  @action
  private onTypeSearchChange(term: string) {
    this.typeSummaries.onSearchChange(term);
  }

  @action
  private onLoadMoreTypes() {
    this.typeSummaries.onLoadMore();
  }

  <template>
    {{yield
      (component
        SearchBar
        value=@searchKey
        realmFilter=this.realmFilter
        typeFilter=this.typeFilter
      )
      (component
        PanelContent
        searchKey=@searchKey
        realmFilter=this.realmFilter
        typeFilter=this.typeFilter
        baseFilter=@baseFilter
        activeSort=this.activeSort
        onSortChange=this.onSortChange
        initialFocusedSection=this.initialFocusedSectionId
      )
    }}
  </template>
}
