import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { cached, tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { restartableTask } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

import debounce from 'lodash/debounce';

import flatMap from 'lodash/flatMap';

import { TrackedArray } from 'tracked-built-ins';

import {
  Button,
  Label,
  BoxelInput,
  BoxelInputBottomTreatments,
} from '@cardstack/boxel-ui/components';

import { eq, gt, or } from '@cardstack/boxel-ui/helpers';

import {
  type ResolvedCodeRef,
  catalogEntryRef,
} from '@cardstack/runtime-common';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RecentCards from '@cardstack/host/services/recent-cards-service';

import { CardDef } from 'https://cardstack.com/base/card-api';

import { getCard } from '../../resources/card-resource';

import SearchResult from './search-result';

import type CardService from '../../services/card-service';
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
    onCardSelect: (card: CardDef) => void;
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
  @tracked private isSearching = false;
  private searchCardResults: CardDef[] = new TrackedArray<CardDef>();
  @tracked cardURL = '';
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  @service declare recentCardsService: RecentCards;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.args.onSetup(this.doExternallyTriggeredSearch);
  }

  private get inputBottomTreatment() {
    return this.args.mode == SearchSheetModes.Closed
      ? BoxelInputBottomTreatments.Rounded
      : BoxelInputBottomTreatments.Flat;
  }

  private get searchLabel() {
    if (this.getCard.isRunning) {
      return `Fetching ${this.searchKey}`;
    } else if (this.searchKeyIsURL) {
      if (this.searchCardResults.length) {
        return `Card found at ${this.searchKey}`;
      } else {
        return `No card found at ${this.searchKey}`;
      }
    } else if (this.isSearching) {
      return `Searching for “${this.searchKey}”`;
    } else {
      return `${this.searchCardResults.length} Result${
        this.searchCardResults.length != 1 ? 's' : ''
      } for “${this.searchKey}”`;
    }
  }

  private get inputValidationState() {
    if (
      this.searchKeyIsURL &&
      !this.getCard.isRunning &&
      !this.searchCardResults.length
    ) {
      return 'invalid';
    } else {
      return 'initial';
    }
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

  private getCard = restartableTask(async (cardURL: string) => {
    this.clearSearchCardResults();

    let maybeIndexCardURL = this.cardService.realmURLs.find(
      (u) => u === cardURL + '/',
    );
    const cardResource = getCard(this, () => maybeIndexCardURL ?? cardURL, {
      isLive: () => false,
    });
    await cardResource.loaded;
    let { card } = cardResource;
    if (!card) {
      console.warn(`Unable to fetch card at ${cardURL}`);
      return;
    }
    this.searchCardResults.push(card);
  });

  @action
  private onCancel() {
    this.resetState();
    this.args.onCancel();
  }

  @action private handleCardSelect(card: CardDef) {
    this.resetState();
    this.args.onCardSelect(card);
  }

  @action
  private doExternallyTriggeredSearch(term: string) {
    this.searchKey = term;
    this.searchCard.perform(this.searchKey);
  }

  private resetState() {
    this.searchKey = '';
    this.cardURL = '';
    this.clearSearchCardResults();
  }

  @cached
  private get orderedRecentCards() {
    // Most recently added first
    return [...this.recentCardsService.recentCards].reverse();
  }

  private debouncedSearchFieldUpdate = debounce(() => {
    if (!this.searchKey) {
      this.clearSearchCardResults();
      this.isSearching = false;
      return;
    }
    this.onSearchFieldUpdated();
  }, 500);

  @action
  private onSearchFieldUpdated() {
    if (this.searchKey) {
      if (this.searchKeyIsURL) {
        this.getCard.perform(this.searchKey);
      } else {
        this.clearSearchCardResults();
        this.searchCard.perform(this.searchKey);
      }
    }
  }

  @action
  private setSearchKey(searchKey: string) {
    this.searchKey = searchKey;
    this.isSearching = true;
    this.debouncedSearchFieldUpdate();
    this.args.onSearch?.(searchKey);
  }

  private clearSearchCardResults() {
    this.searchCardResults.splice(0, this.searchCardResults.length);
  }

  private searchCard = restartableTask(async (searchKey: string) => {
    let type = getCodeRefFromSearchKey(searchKey);
    let searchTerm = !type ? searchKey : undefined;
    let query = {
      filter: {
        every: [
          {
            ...(type
              ? { type }
              : {
                  not: {
                    type: catalogEntryRef,
                  },
                }),
          },
          ...(searchTerm
            ? [
                {
                  contains: {
                    title: searchTerm,
                  },
                },
              ]
            : []),
        ],
      },
    };

    let cards = flatMap(
      await Promise.all(
        this.cardService.realmURLs.map(
          async (realm) => await this.cardService.search(query, new URL(realm)),
        ),
      ),
    );

    if (cards.length > 0) {
      this.searchCardResults.push(...cards);
    } else {
      this.clearSearchCardResults();
    }

    this.isSearching = false;
  });

  private get isSearchKeyNotEmpty() {
    return !!this.searchKey && this.searchKey !== '';
  }

  @action private onSearchInputKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.onCancel();
      (e.target as HTMLInputElement)?.blur?.();
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
        @onInput={{this.setSearchKey}}
        {{elementCallback @onInputInsertion}}
        {{on 'keydown' this.onSearchInputKeyDown}}
        class='search-sheet__search-input-group'
        data-test-search-field
      />
      <div class='search-sheet-content'>
        {{! @glint-ignore Argument of type 'string' is not assignable to parameter of type 'boolean' }}
        {{#if
          (or (gt this.searchCardResults.length 0) this.isSearchKeyNotEmpty)
        }}
          <div class='search-result-section'>
            <Label data-test-search-label>{{this.searchLabel}}</Label>
            <div class='search-result-section__body'>
              <div class='search-result-section__cards'>
                {{#each this.searchCardResults as |card i|}}
                  <SearchResult
                    @card={{card}}
                    @compact={{eq this.sheetSize 'prompt'}}
                    {{on 'click' (fn this.handleCardSelect card)}}
                    data-test-search-sheet-search-result={{i}}
                  />
                {{/each}}
              </div>
            </div>
          </div>
        {{/if}}
        {{#if this.recentCardsService.any}}
          <div class='search-result-section'>
            <Label>Recent</Label>
            <div class='search-result-section__body'>
              <div class='search-result-section__cards'>
                {{#each this.orderedRecentCards as |card i|}}
                  <SearchResult
                    @card={{card}}
                    @compact={{eq this.sheetSize 'prompt'}}
                    {{on 'click' (fn this.handleCardSelect card)}}
                    data-test-search-sheet-recent-card={{i}}
                  />
                {{/each}}
              </div>
            </div>
          </div>
        {{/if}}
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
      .search-result-section {
        display: flex;
        flex-direction: column;
        width: 100%;
      }
      .prompt .search-result-section {
        flex-direction: row;
        align-items: center;
        height: 100%;
      }

      .search-result-section .boxel-label {
        font: 700 var(--boxel-font);
        padding-right: var(--boxel-sp);
      }
      .search-result-section__body {
        overflow: auto;
      }
      .search-result-section__cards {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        padding: var(--boxel-sp) var(--boxel-sp-xxxs);
        gap: var(--boxel-sp);
      }
      .prompt .search-result-section__cards {
        display: flex;
        flex-wrap: nowrap;
        padding: var(--boxel-sp-xxs);
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

function getCodeRefFromSearchKey(
  searchKey: string,
): ResolvedCodeRef | undefined {
  if (searchKey.startsWith('carddef:')) {
    let internalKey = searchKey.substring('carddef:'.length);
    let parts = internalKey.split('/');
    let name = parts.pop()!;
    let module = parts.join('/');
    return { module, name };
  }
  return undefined;
}
