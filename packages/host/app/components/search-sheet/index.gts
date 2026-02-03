import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { debounce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { consume } from 'ember-provide-consume-context';

import { trackedFunction } from 'reactiveweb/function';

import {
  Button,
  IconButton,
  BoxelInputBottomTreatments,
} from '@cardstack/boxel-ui/components';
import type { PickerOption } from '@cardstack/boxel-ui/components';

import { eq } from '@cardstack/boxel-ui/helpers';
import { IconSearch } from '@cardstack/boxel-ui/icons';

import { type getCard, GetCardContextName } from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';

import CardQueryResults from './card-query-results';
import CardURLResults from './card-url-results';
import RecentCardsSection from './recent-cards-section';
import SearchBar from './search-bar';
import { getCodeRefFromSearchKey } from './utils';

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
    onSetup: (doSearch: (term: string) => void) => void;
    onCancel: () => void;
    onFocus: () => void;
    onBlur: () => void;
    onSearch: (term: string) => void;
    onCardSelect: (cardId: string) => void;
    onInputInsertion?: (element: HTMLElement) => void;
  };
  Blocks: {};
}

export default class SearchSheet extends Component<Signature> {
  @consume(GetCardContextName) declare private getCard: getCard;

  @tracked private searchKey = '';
  @tracked selectedRealms: PickerOption[] = [];

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
    let maybeType = getCodeRefFromSearchKey(this.searchKey);
    if (maybeType) {
      return false;
    }
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

  @action private handleCardSelect(cardId: string) {
    this.resetState();
    this.args.onCardSelect(cardId);
  }

  @action
  private doExternallyTriggeredSearch(term: string) {
    this.searchKey = term;
  }

  private resetState() {
    this.searchKey = '';
    this.selectedRealms = [];
  }

  private get selectedRealmURLs(): string[] {
    const hasSelectAll = this.selectedRealms.some(
      (opt) => opt.type === 'select-all',
    );
    if (hasSelectAll || this.selectedRealms.length === 0) {
      return this.realmServer.availableRealmURLs;
    }
    return this.selectedRealms.map((opt) => opt.id).filter(Boolean);
  }

  @action
  private onRealmChange(selected: PickerOption[]) {
    this.selectedRealms = selected;
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

  private get isSearchKeyEmpty() {
    return (this.searchKey?.trim() || '') === '';
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
        @onBlur
        exceptSelector='.add-card-to-neighbor-stack,.boxel-picker__dropdown,.picker-before-options-with-search,.picker-option-row'
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
        <SearchBar
          @value={{this.searchKey}}
          @placeholder={{this.placeholderText}}
          @state={{this.inputValidationState}}
          @bottomTreatment={{this.inputBottomTreatment}}
          @onFocus={{@onFocus}}
          @onInput={{this.debouncedSetSearchKey}}
          @onKeyDown={{this.onSearchInputKeyDown}}
          @onInputInsertion={{@onInputInsertion}}
          @selectedRealms={{this.selectedRealms}}
          @onRealmChange={{this.onRealmChange}}
          class='search-sheet__search-input-group'
          autocomplete='off'
        />
        <div class='search-sheet-content'>
          {{#if this.searchKeyIsURL}}
            <CardURLResults
              @url={{this.searchKey}}
              @handleCardSelect={{this.handleCardSelect}}
              @isCompact={{this.isCompact}}
              @searchKeyAsURL={{this.searchKeyAsURL}}
            />
          {{else if this.isSearchKeyEmpty}}
            {{! nothing }}
          {{else}}
            <CardQueryResults
              @searchKey={{this.searchKey}}
              @realms={{this.selectedRealmURLs}}
              @handleCardSelect={{this.handleCardSelect}}
              @isCompact={{this.isCompact}}
            />
          {{/if}}
          <RecentCardsSection
            @handleCardSelect={{this.handleCardSelect}}
            @isCompact={{this.isCompact}}
          />
        </div>
        <div class='footer'>
          <div class='buttons'>
            <Button
              {{on 'click' this.onCancel}}
              data-test-search-sheet-cancel-button
            >Cancel</Button>
          </div>
        </div>
      {{/if}}
    </div>
    <style scoped>
      :global(:root) {
        --search-sheet-closed-height: calc(
          var(--operator-mode-bottom-bar-item-height) +
            var(--operator-mode-spacing)
        );
        --search-sheet-closed-width: var(--container-button-size);
        --search-sheet-prompt-height: 9.375rem;
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
        border-top-right-radius: var(--boxel-border-radius-xxl);
        border-top-left-radius: var(--boxel-border-radius-xxl);
        border-bottom-right-radius: 0;
        border-bottom-left-radius: 0;
        overflow: hidden;
      }
      .search-sheet:not(.closed):deep(.input-container),
      .search-sheet:not(.closed):deep(.search-sheet__search-input-group),
      .search-sheet:not(.closed):deep(.search-sheet__search-bar) {
        border-radius: inherit;
      }

      .search-sheet__search-input-group,
      .search-sheet__search-bar {
        transition:
          height var(--boxel-transition),
          width var(--boxel-transition);
      }

      .closed {
        height: var(--search-sheet-closed-height);
        width: var(--search-sheet-closed-width);
      }

      .search-sheet.closed .search-sheet-content {
        display: none;
      }

      .prompt {
        height: var(--search-sheet-prompt-height);
        box-shadow: var(--boxel-deep-box-shadow);
      }

      .results {
        height: calc(100% - var(--stack-padding-top));
        box-shadow: var(--boxel-deep-box-shadow);
      }

      .footer {
        display: flex;
        flex-shrink: 0;
        justify-content: space-between;
        opacity: 1;
        height: var(--stack-card-footer-height);
        padding: var(--boxel-sp);
        background-color: var(--boxel-light);
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

      .closed .search-sheet-content,
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

      .search-sheet-content {
        height: 100%;
        background-color: var(--boxel-light);
        border-bottom: 1px solid var(--boxel-200);
        padding: 0 var(--boxel-sp-lg);
        transition: opacity calc(var(--boxel-transition) / 4);
      }
      .results .search-sheet-content {
        padding-top: var(--boxel-sp);
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow-y: auto;
      }
      .prompt .search-sheet-content {
        overflow-x: auto;
      }

      .open-search-field:focus:focus-visible {
        outline-offset: 0;
        outline-width: 2px;
      }
    </style>
  </template>
}
