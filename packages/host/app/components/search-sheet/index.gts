import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { cancel, debounce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { motion } from 'glimmer-motion';

import { trackedFunction } from 'reactiveweb/function';

import {
  Button,
  IconButton,
  BoxelInputBottomTreatments,
} from '@cardstack/boxel-ui/components';

import { eq } from '@cardstack/boxel-ui/helpers';
import { IconSearch } from '@cardstack/boxel-ui/icons';

import type { ResolvedCodeRef } from '@cardstack/runtime-common';

import {
  searchCardOrigin,
  type CardOpenOrigin,
} from '@cardstack/host/lib/card-open-origin';

import type RealmServerService from '@cardstack/host/services/realm-server';
import type SearchSheetStateService from '@cardstack/host/services/search-sheet-state';
import { SEARCH_SHEET_BASE_FILTER } from '@cardstack/host/services/search-sheet-state';
import { removeCardJsonExtension } from '@cardstack/host/utils/search/types';
import type { SearchResultKind } from '@cardstack/host/utils/search/types';
import {
  isURLSearchKey,
  resolveSearchKeyAsURL,
} from '@cardstack/host/utils/search/url';

import SearchPanel from '../search/panel';

import SearchSheetMotion from './motion';

import type StoreService from '../../services/store';
import type { SortOption } from '../search/constants';

export const SearchSheetModes = {
  Closed: 'closed',
  ChoosePrompt: 'choose-prompt',
  ChooseResults: 'choose-results',
  SearchPrompt: 'search-prompt',
  SearchResults: 'search-results',
} as const;

type Values<T> = T[keyof T];
export type SearchSheetMode = Values<typeof SearchSheetModes>;

interface Signature {
  Element: HTMLElement;
  Args: {
    mode: SearchSheetMode;
    instant?: boolean;
    onSetup: (
      doSearch: (term: string, typeRef?: ResolvedCodeRef) => void,
    ) => void;
    onCancel: () => void;
    onFocus: () => void;
    onBlur: () => void;
    onSearch: (term: string) => void;
    onCardSelect: (
      cardId: string,
      kind?: SearchResultKind,
      origin?: CardOpenOrigin,
    ) => void;
    onInputInsertion?: (element: HTMLElement) => void;
    onFilterChange?: () => void;
  };
  Blocks: {};
}

export default class SearchSheet extends Component<Signature> {
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;
  @service('search-sheet-state')
  declare private searchSheetState: SearchSheetStateService;

  // The sheet's search state is held in the session-scoped service so it
  // survives the close/reopen that unmounts this component's subtree.
  private get searchKey() {
    return this.searchSheetState.searchKey;
  }
  private set searchKey(value: string) {
    this.searchSheetState.searchKey = value;
  }

  private get initialSelectedTypes(): ResolvedCodeRef[] | undefined {
    return this.searchSheetState.selectedTypes;
  }

  private get initialSelectedRealms(): URL[] {
    return this.searchSheetState.selectedRealms;
  }

  private get initialActiveSort(): SortOption | undefined {
    return this.searchSheetState.activeSort;
  }

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.args.onSetup(this.doExternallyTriggeredSearch);
  }

  private get inputBottomTreatment() {
    return this.args.mode == SearchSheetModes.Closed
      ? BoxelInputBottomTreatments.Rounded
      : BoxelInputBottomTreatments.Flat;
  }

  private get sheetSize() {
    switch (this.args.mode) {
      case SearchSheetModes.Closed:
        return 'closed';
      case SearchSheetModes.ChoosePrompt:
      case SearchSheetModes.SearchPrompt:
        return 'prompt';
      case SearchSheetModes.ChooseResults:
      case SearchSheetModes.SearchResults:
        return 'results';
      default:
        return 'closed';
    }
  }

  private get placeholderText() {
    let mode = this.args.mode;
    if (
      mode == SearchSheetModes.SearchPrompt ||
      mode == SearchSheetModes.ChoosePrompt
    ) {
      return 'Search for cards and files or enter card URL';
    }
    return 'Search for…';
  }

  private get searchKeyIsURL() {
    return isURLSearchKey(this.searchKey);
  }

  @action
  private onCancel() {
    this.resetState();
    this.args.onCancel();
  }

  @action
  private onBlur() {
    // A plain close/blur keeps the search so reopening restores it; only an
    // explicit Cancel (or Escape) resets.
    this.args.onBlur();
  }

  private selectedOrigin?: ReturnType<typeof searchCardOrigin>;

  @action private captureSelection(event: Event) {
    this.selectedOrigin = searchCardOrigin(event);
  }

  @action private handleCardSelect(
    selection: string | { realmURL: string },
    kind?: SearchResultKind,
  ) {
    if (typeof selection !== 'string') {
      return;
    }
    // Selecting a result keeps the search, so reopening returns to it. `kind`
    // carries the result's card/file classification so the consumer opens the
    // right URL without re-deriving it from the id.
    let selected = this.selectedOrigin;
    this.selectedOrigin = undefined;
    let origin =
      kind !== 'file' && selected?.cardId === removeCardJsonExtension(selection)
        ? selected?.origin
        : undefined;
    this.args.onCardSelect(selection, kind, origin);
  }

  @action
  private doExternallyTriggeredSearch(term: string, typeRef?: ResolvedCodeRef) {
    // A triggered search starts clean: leftover state from a previously
    // persisted search (realm scope, sort, scroll offset, a pending debounce)
    // must not silently narrow, position, or overwrite it. Reset everything,
    // then apply the trigger's own term and type. Bumping the epoch remounts a
    // `SearchPanel` that's already mounted (the sheet was open), so its
    // init-once filter display re-reads the freshly-reset state instead of
    // showing stale chips over the correctly-rescoped search.
    this.resetState();
    this.searchKey = term;
    this.searchSheetState.selectedTypes = typeRef ? [typeRef] : undefined;
    this.searchSheetState.searchTriggerEpoch++;
  }

  // The pending 300ms debounce handle, kept so Cancel/Escape can cancel it —
  // otherwise a keystroke within 300ms of a reset re-persists the cancelled
  // term and reopens the sheet.
  private pendingSearchKeyDebounce: ReturnType<typeof debounce> | undefined;

  private resetState() {
    if (this.pendingSearchKeyDebounce) {
      cancel(this.pendingSearchKeyDebounce);
      this.pendingSearchKeyDebounce = undefined;
    }
    this.searchSheetState.resetState();
  }

  @action private debouncedSetSearchKey(searchKey: string) {
    this.pendingSearchKeyDebounce = debounce(
      this,
      this.setSearchKey,
      searchKey,
      300,
    );
  }

  @action
  private setSearchKey(searchKey: string) {
    this.searchKey = searchKey;
    this.args.onSearch?.(searchKey);
  }

  @action private handleRealmChange(selectedRealms: URL[]) {
    this.searchSheetState.selectedRealms = selectedRealms;
    this.args.onFilterChange?.();
  }

  @action private handleTypeChange(selectedTypes: ResolvedCodeRef[]) {
    this.searchSheetState.selectedTypes = selectedTypes;
    this.args.onFilterChange?.();
  }

  @action private handleSortChange(option: SortOption) {
    // Unlike realm/type changes, no `onFilterChange` here: the sort control only
    // exists in the results view, so there's never a prompt→results expansion to
    // trigger — just record the choice for persistence.
    this.searchSheetState.activeSort = option;
  }

  // The panel is a controlled consumer here: it renders the session-scoped
  // service's view id / scroll offset and reports changes back through these,
  // so both survive the sheet's close/reopen.
  @action private handleViewIdChange(id: string) {
    this.searchSheetState.activeViewId = id;
  }

  @action private handleScrollTopChange(scrollTop: number) {
    this.searchSheetState.resultsScrollTop = scrollTop;
  }

  @action private onSearchInputKeyDown(e: Event) {
    let kbEvent = e as KeyboardEvent;
    if (kbEvent.key === 'Escape') {
      this.onCancel();
      (kbEvent.target as HTMLInputElement)?.blur?.();
    }
  }

  private get isCompact() {
    return this.sheetSize === 'prompt';
  }

  private get searchKeyAsURL() {
    return resolveSearchKeyAsURL(
      this.searchKey,
      this.realmServer.availableRealmIdentifiers,
    );
  }

  // note that this is a card that is eligible for garbage collection
  // and is meant for immediate consumption. it's not safe to pass this
  // as state for another component.
  private fetchCardByUrl = trackedFunction(this, async () => {
    if (!this.searchKeyAsURL) {
      return;
    }
    let card = await this.store.get(this.searchKeyAsURL);
    return {
      card,
    };
  });

  private get fetchCardByUrlResult() {
    let value = this.fetchCardByUrl.value;
    if (value) {
      if (value.card) {
        return { card: value.card };
      } else {
        return { card: null };
      }
    }

    return undefined;
  }

  private get inputValidationState() {
    if (
      this.searchKeyIsURL &&
      this.fetchCardByUrlResult &&
      !this.fetchCardByUrlResult.card
    ) {
      return 'invalid';
    } else {
      return 'none';
    }
  }

  <template>
    <SearchSheetMotion
      @size={{this.sheetSize}}
      @instant={{@instant}}
      id='search-sheet'
      {{on 'click' this.captureSelection capture=true}}
      {{on 'keydown' this.captureSelection capture=true}}
      data-test-search-sheet={{@mode}}
      {{onClickOutside
        this.onBlur
        exceptSelector='.add-card-to-neighbor-stack,.boxel-dropdown__content,.boxel-picker__dropdown,.boxel-select__dropdown,.picker-before-options-with-search,.picker-option-row,.search-sheet-header,.search-sheet-section-header'
      }}
    >
      {{#if (eq @mode 'closed')}}
        <IconButton
          class='open-search-field'
          @icon={{IconSearch}}
          @width='18'
          @height='24'
          @round={{true}}
          @variant='primary-dark'
          {{on 'click' @onFocus}}
          data-test-open-search-field
        />
      {{else}}
        {{! Keyed on the trigger epoch so an externally-triggered search (which
            bumps it) remounts the panel — the only way its init-once filter
            display picks up the freshly-reset state while the sheet is already
            open. A normal reopen doesn't bump the epoch, so it reuses the
            panel. }}
        {{#each
          (array this.searchSheetState.searchTriggerEpoch) key='@identity'
          as |_epoch|
        }}
          <SearchPanel
            @searchKey={{this.searchKey}}
            @baseFilter={{SEARCH_SHEET_BASE_FILTER}}
            @initialSelectedTypes={{this.initialSelectedTypes}}
            @initialSelectedRealms={{this.initialSelectedRealms}}
            @initialActiveSort={{this.initialActiveSort}}
            @onRealmChange={{this.handleRealmChange}}
            @onTypeChange={{this.handleTypeChange}}
            @onSortChange={{this.handleSortChange}}
            as |Bar Content|
          >
            <Bar
              class='search-sheet__search-input-group'
              {{motion role='search-sheet-header'}}
              @placeholder={{this.placeholderText}}
              @state={{this.inputValidationState}}
              @bottomTreatment={{this.inputBottomTreatment}}
              @onFocus={{@onFocus}}
              @onInput={{this.debouncedSetSearchKey}}
              @onKeyDown={{this.onSearchInputKeyDown}}
              @onInputInsertion={{@onInputInsertion}}
              @autocomplete='off'
            />
            <Content
              class='search-sheet__content'
              {{motion role='search-sheet-content'}}
              @isCompact={{this.isCompact}}
              @handleSelect={{this.handleCardSelect}}
              @adorn={{true}}
              @mainSearchResource={{this.searchSheetState.mainSearch}}
              @viewId={{this.searchSheetState.activeViewId}}
              @onViewIdChange={{this.handleViewIdChange}}
              @pagination={{this.searchSheetState.pagination}}
              @scrollTop={{this.searchSheetState.resultsScrollTop}}
              @onScrollTopChange={{this.handleScrollTopChange}}
            />
            <div class='footer' {{motion role='search-sheet-footer'}}>
              <div class='buttons'>
                <Button
                  {{on 'click' this.onCancel}}
                  data-test-search-sheet-cancel-button
                >Cancel</Button>
              </div>
            </div>
          </SearchPanel>
        {{/each}}
      {{/if}}
    </SearchSheetMotion>
    <style scoped>
      .search-sheet__search-input-group {
        width: calc(100% - 2 * var(--boxel-sp-xs));
        margin: var(--boxel-sp-xs);
        flex-wrap: nowrap;
        overflow: hidden;
      }
      .results .search-sheet__search-input-group {
        margin-bottom: 3px;
      }

      .search-sheet__content {
        padding-inline: var(--boxel-sp);
      }

      .footer {
        display: flex;
        flex-shrink: 0;
        justify-content: space-between;
        opacity: 1;
        height: var(--stack-card-footer-height);
        padding: var(--boxel-sp);
        background-color: var(--boxel-light);
        border-top: 1px solid var(--boxel-200);
        overflow: hidden;
      }

      .closed .footer,
      .prompt .footer {
        height: 0;
        padding: 0;
      }

      .closed .footer,
      .prompt .footer {
        height: 0;
        opacity: 0;
      }

      .buttons {
        margin-top: var(--boxel-sp-xs);
      }
      .buttons > * + * {
        margin-left: var(--boxel-sp-xs);
      }

      .open-search-field {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 1;
        transform-origin: top left;
      }
      .open-search-field:focus:focus-visible {
        outline-offset: 0;
        outline-width: 2px;
      }
    </style>
  </template>
}
