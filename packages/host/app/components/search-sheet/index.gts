import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { debounce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { modifier } from 'ember-modifier';

import { trackedFunction } from 'ember-resources/util/function';

import {
  Button,
  BoxelInput,
  BoxelInputBottomTreatments,
} from '@cardstack/boxel-ui/components';

import { eq } from '@cardstack/boxel-ui/helpers';

import { getCard } from '@cardstack/host/resources/card-resource';
import CardService from '@cardstack/host/services/card-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import CardQueryResults from './card-query-results';
import CardURLResults from './card-url-results';

import RecentCardsSection from './recent-cards-section';
import { getCodeRefFromSearchKey } from './utils';

import type LoaderService from '../../services/loader-service';

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

let elementCallback = modifier(
  (element, [callback]: [((element: HTMLElement) => void) | undefined]) => {
    if (callback) {
      callback(element as HTMLElement);
    }
  },
);

export default class SearchSheet extends Component<Signature> {
  @tracked private searchKey = '';
  @tracked cardURL = '';

  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;

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

  get isCompact() {
    return this.sheetSize === 'prompt';
  }

  get isSearchKeyEmpty() {
    return (this.searchKey?.trim() || '') === '';
  }

  private fetchCardByUrl = trackedFunction(this, async () => {
    if (!this.searchKeyIsURL) {
      return;
    }
    let cardURL = this.searchKey;

    let maybeIndexCardURL = this.cardService.realmURLs.find(
      (u) => u === cardURL + '/',
    );
    let cardResource = getCard(this, () => maybeIndexCardURL ?? cardURL, {
      isLive: () => false,
    });

    await cardResource.loaded;
    let { card } = cardResource;

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
      return 'initial';
    }
  }

  <template>
    <div
      id='search-sheet'
      class='search-sheet {{this.sheetSize}}'
      data-test-search-sheet={{@mode}}
      {{onClickOutside @onBlur exceptSelector='.add-card-to-neighbor-stack'}}
    >
      <BoxelInput
        @type='search'
        @variant={{if (eq @mode 'closed') 'default' 'large'}}
        @bottomTreatment={{this.inputBottomTreatment}}
        @value={{this.searchKey}}
        @state={{this.inputValidationState}}
        @placeholder={{this.placeholderText}}
        @onFocus={{@onFocus}}
        @onInput={{this.debouncedSetSearchKey}}
        {{elementCallback @onInputInsertion}}
        {{on 'keydown' this.onSearchInputKeyDown}}
        class='search-sheet__search-input-group'
        autocomplete='off'
        data-test-search-field
      />
      <div class='search-sheet-content'>
        {{#if this.searchKeyIsURL}}
          <CardURLResults
            @url={{this.searchKey}}
            @handleCardSelect={{this.handleCardSelect}}
            @isCompact={{this.isCompact}}
            @fetchCardByUrlResult={{this.fetchCardByUrlResult}}
          />
        {{else if this.isSearchKeyEmpty}}
          {{! nothing }}
        {{else}}
          <CardQueryResults
            @searchKey={{this.searchKey}}
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
    </div>
    <style>
      :global(:root) {
        --search-sheet-closed-height: 3.5rem;
        --search-sheet-closed-width: 10.75rem;
        --search-sheet-prompt-height: 9.375rem;
      }

      .search-sheet {
        background-color: transparent;
        bottom: 0;
        display: flex;
        flex-direction: column;
        justify-content: stretch;
        left: calc(6 * var(--boxel-sp-xs));
        width: calc(100% - (7 * var(--boxel-sp)));
        position: absolute;
        z-index: 1;
        transition:
          height var(--boxel-transition),
          width var(--boxel-transition);
      }

      .search-sheet__search-input-group {
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
    </style>
  </template>
}
