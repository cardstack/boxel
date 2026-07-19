import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { debounce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { modifier } from 'ember-modifier';

import { trackedFunction } from 'reactiveweb/function';

import {
  Button,
  IconButton,
  BoxelInputBottomTreatments,
} from '@cardstack/boxel-ui/components';

import { eq } from '@cardstack/boxel-ui/helpers';
import { IconSearch } from '@cardstack/boxel-ui/icons';

import {
  type Filter,
  type ResolvedCodeRef,
  baseRef,
} from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';
import type SearchSheetStateService from '@cardstack/host/services/search-sheet-state';
import {
  isURLSearchKey,
  resolveSearchKeyAsURL,
} from '@cardstack/host/utils/search/url';

import SearchPanel from '../search/panel';

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
    onSetup: (
      doSearch: (term: string, typeRef?: ResolvedCodeRef) => void,
    ) => void;
    onCancel: () => void;
    onFocus: () => void;
    onBlur: () => void;
    onSearch: (term: string) => void;
    onCardSelect: (cardId: string) => void;
    onInputInsertion?: (element: HTMLElement) => void;
    onFilterChange?: () => void;
  };
  Blocks: {};
}

// After the search sheet's height transition ends, dispatch a window resize
// event so ember-basic-dropdown repositions any open wormholed dropdowns
// (e.g. TypePicker, RealmPicker) whose trigger moved during the transition.
const repositionDropdownsOnTransitionEnd = modifier((element: Element) => {
  let handler = (event: TransitionEvent) => {
    if (event.propertyName === 'height') {
      window.dispatchEvent(new Event('resize'));
    }
  };
  element.addEventListener('transitionend', handler as EventListener);
  return () =>
    element.removeEventListener('transitionend', handler as EventListener);
});

// The sheet searches everything the index knows — cards (including specs,
// which the default `not: specRef` query path excludes), field instances, and
// files. BaseDef is the common ancestor stamped on both instance and file type
// chains, so this one ref spans all kinds; `scope: 'all'` rides the wire
// alongside (see `searchScopeForOptions`).
const BASE_FILTER: Filter = { type: baseRef };

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
    }
    return undefined;
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

  @action private handleCardSelect(selection: string | { realmURL: string }) {
    if (typeof selection !== 'string') {
      return;
    }
    // Selecting a result keeps the search, so reopening returns to it.
    this.args.onCardSelect(selection);
  }

  @action
  private doExternallyTriggeredSearch(term: string, typeRef?: ResolvedCodeRef) {
    this.searchKey = term;
    this.searchSheetState.selectedTypes = typeRef ? [typeRef] : undefined;
  }

  private resetState() {
    this.searchSheetState.resetState();
  }

  @action private debouncedSetSearchKey(searchKey: string) {
    debounce(this, this.setSearchKey, searchKey, 300);
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
    <div
      id='search-sheet'
      class='search-sheet {{this.sheetSize}}'
      data-test-search-sheet={{@mode}}
      {{repositionDropdownsOnTransitionEnd}}
      {{onClickOutside
        this.onBlur
        exceptSelector='.add-card-to-neighbor-stack,.boxel-picker__dropdown,.picker-before-options-with-search,.picker-option-row,.search-sheet-header,.search-sheet-section-header,.variant-default'
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
        <SearchPanel
          @searchKey={{this.searchKey}}
          @baseFilter={{BASE_FILTER}}
          @initialSelectedTypes={{this.initialSelectedTypes}}
          @initialSelectedRealms={{this.initialSelectedRealms}}
          @initialActiveSort={{this.initialActiveSort}}
          @persist={{true}}
          @onRealmChange={{this.handleRealmChange}}
          @onTypeChange={{this.handleTypeChange}}
          @onSortChange={{this.handleSortChange}}
          as |Bar Content|
        >
          <Bar
            class='search-sheet__search-input-group'
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
            @isCompact={{this.isCompact}}
            @handleSelect={{this.handleCardSelect}}
            @adorn={{true}}
          />
          <div class='footer'>
            <div class='buttons'>
              <Button
                {{on 'click' this.onCancel}}
                data-test-search-sheet-cancel-button
              >Cancel</Button>
            </div>
          </div>
        </SearchPanel>
      {{/if}}
    </div>
    <style scoped>
      :global(:root) {
        --search-sheet-closed-height: calc(
          var(--operator-mode-bottom-bar-item-height) +
            var(--operator-mode-spacing)
        );
        --search-sheet-closed-width: var(--container-button-size);
        --search-sheet-prompt-height: 10.45rem;
      }

      .search-sheet {
        --search-sheet-left-offset: calc(var(--operator-mode-spacing));
        --search-sheet-right-offset: calc(
          var(--container-button-size) + 2 * var(--operator-mode-spacing)
        );
        background-color: transparent;
        bottom: 0;
        display: flex;
        flex-direction: column;
        justify-content: stretch;
        left: var(--search-sheet-left-offset);
        width: calc(
          100% - var(--search-sheet-left-offset) -
            var(--search-sheet-right-offset)
        );
        position: absolute;
        z-index: var(--host-search-sheet-z-index);
        transition:
          height var(--boxel-transition),
          width var(--boxel-transition);
      }
      .search-sheet:not(.closed) {
        overflow: hidden;
        background-color: var(--boxel-light);
        border-top-right-radius: var(--boxel-border-radius-xxl);
        border-top-left-radius: var(--boxel-border-radius-xxl);
        border-bottom-right-radius: 0;
        border-bottom-left-radius: 0;
      }
      .search-sheet__search-input-group {
        width: calc(100% - 2 * var(--boxel-sp-xs));
        margin: var(--boxel-sp-xs);
        flex-wrap: nowrap;
        overflow: hidden;
        animation: fade-in var(--boxel-transition);
      }
      @keyframes fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .results .search-sheet__search-input-group {
        margin-bottom: 3px;
      }

      .closed {
        height: var(--search-sheet-closed-height);
        width: var(--search-sheet-closed-width);
      }

      .prompt {
        height: var(--search-sheet-prompt-height);
        box-shadow: var(--boxel-deep-box-shadow);
      }

      .results {
        height: calc(100% - var(--stack-padding-top));
        box-shadow: var(--boxel-deep-box-shadow);
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

        transition:
          flex var(--boxel-transition),
          opacity calc(var(--boxel-transition) / 4);
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
