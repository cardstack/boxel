import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { debounce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

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
  baseCardRef,
  baseFieldRef,
} from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';

import SearchPanel from '../card-search/panel';

import type StoreService from '../../services/store';

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

export default class SearchSheet extends Component<Signature> {
  @tracked private searchKey = '';
  @tracked private initialSelectedType: ResolvedCodeRef | undefined;

  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;

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
      return 'Search for cards or enter card URL';
    }
    return 'Search for…';
  }

  private get searchKeyIsURL() {
    try {
      new URL(this.searchKey);
      return true;
    } catch (_e) {
      return false;
    }
  }

  @action
  private onCancel() {
    this.resetState();
    this.args.onCancel();
  }

  @action
  private onBlur() {
    this.args.onBlur();
    if (this.args.mode === SearchSheetModes.Closed) {
      this.resetState();
    }
  }

  @action private handleCardSelect(selection: string | { realmURL: string }) {
    if (typeof selection !== 'string') {
      return;
    }
    this.resetState();
    this.args.onCardSelect(selection);
  }

  @action
  private doExternallyTriggeredSearch(term: string, typeRef?: ResolvedCodeRef) {
    this.searchKey = term;
    this.initialSelectedType = typeRef;
  }

  private resetState() {
    this.searchKey = '';
    this.initialSelectedType = undefined;
  }

  @action private debouncedSetSearchKey(searchKey: string) {
    debounce(this, this.setSearchKey, searchKey, 300);
  }

  @action
  private setSearchKey(searchKey: string) {
    this.searchKey = searchKey;
    this.args.onSearch?.(searchKey);
  }

  @action private onSearchInputKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.onCancel();
      (e.target as HTMLInputElement)?.blur?.();
    }
  }

  private get isCompact() {
    return this.sheetSize === 'prompt';
  }

  private get baseFilter(): Filter {
    return { any: [{ type: baseCardRef }, { type: baseFieldRef }] };
  }

  private get searchKeyAsURL() {
    if (!this.searchKeyIsURL) {
      return undefined;
    }
    let cardURL = this.searchKey;

    let maybeIndexCardURL = this.realmServer.availableRealmURLs.find(
      (u) => u === cardURL + '/',
    );
    return maybeIndexCardURL ?? cardURL;
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
          @baseFilter={{this.baseFilter}}
          @initialSelectedType={{this.initialSelectedType}}
          @onFilterChange={{@onFilterChange}}
          as |Bar Content joinedRealmURLs|
        >
          <Bar
            class='search-sheet__search-input-group'
            @value={{this.searchKey}}
            @placeholder={{this.placeholderText}}
            @state={{this.inputValidationState}}
            @bottomTreatment={{this.inputBottomTreatment}}
            @onFocus={{@onFocus}}
            @onInput={{this.debouncedSetSearchKey}}
            @onKeyDown={{this.onSearchInputKeyDown}}
            @onInputInsertion={{@onInputInsertion}}
            @autocomplete='off'
            data-test-search-realms={{joinedRealmURLs}}
          />
          <Content
            class='search-sheet__content'
            @isCompact={{this.isCompact}}
            @handleSelect={{this.handleCardSelect}}
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
        --search-sheet-prompt-height: 8.75rem;
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
