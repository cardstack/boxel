import Component from '@glimmer/component';
import {
  Button,
  BoxelInputValidationState,
  SearchInput,
  SearchInputBottomTreatment,
} from '@cardstack/boxel-ui';
import { on } from '@ember/modifier';
//@ts-ignore cached not available yet in definitely typed
import { cached, tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import SearchResult from './search-result';
import { Label } from '@cardstack/boxel-ui';
import { eq, gt, or } from '../../helpers/truth-helpers';
import { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type CardService from '../../services/card-service';
import type LoaderService from '../../services/loader-service';
import {
  isSingleCardDocument,
  baseRealm,
  catalogEntryRef,
} from '@cardstack/runtime-common';
import { Card } from 'https://cardstack.com/base/card-api';
import debounce from 'lodash/debounce';
import flatMap from 'lodash/flatMap';
import { TrackedArray } from 'tracked-built-ins';
import ENV from '@cardstack/host/config/environment';
import { htmlSafe } from '@ember/template';

const { otherRealmURLs } = ENV;

export enum SearchSheetMode {
  Closed = 'closed',
  ChoosePrompt = 'choose-prompt',
  ChooseResults = 'choose-results',
  SearchPrompt = 'search-prompt',
  SearchResults = 'search-results',
}

interface Signature {
  Element: HTMLElement;
  Args: {
    mode: SearchSheetMode;
    onCancel: () => void;
    onFocus: () => void;
    onSearch: (term: string) => void;
    onCardSelect: (card: Card) => void;
  };
  Blocks: {};
}

export default class SearchSheet extends Component<Signature> {
  @tracked searchKey = '';
  @tracked isSearching = false;
  searchCardResults: Card[] = new TrackedArray<Card>();
  @tracked cardURL = '';
  @tracked hasCardURLError = false;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;

  get inputBottomTreatment() {
    return this.args.mode == SearchSheetMode.Closed
      ? SearchInputBottomTreatment.Rounded
      : SearchInputBottomTreatment.Flat;
  }

  get sheetSize() {
    switch (this.args.mode) {
      case SearchSheetMode.Closed:
        return 'closed';
      case SearchSheetMode.ChoosePrompt:
      case SearchSheetMode.SearchPrompt:
        return 'prompt';
      case SearchSheetMode.ChooseResults:
      case SearchSheetMode.SearchResults:
        return 'results';
    }
  }

  get isGoDisabled() {
    // TODO after we have ember concurrency task for search implemented,
    // make sure to also include the task.isRunning as criteria for
    // disabling the go button
    return (!this.searchKey && !this.cardURL) || this.getCard.isRunning;
  }

  get cardURLFieldState() {
    return this.hasCardURLError ? 'invalid' : 'initial';
  }

  get cardURLErrorMessage() {
    return this.hasCardURLError ? 'Not a valid Card URL' : undefined;
  }

  get placeholderText() {
    let mode = this.args.mode;
    if (
      mode == SearchSheetMode.SearchPrompt ||
      mode == SearchSheetMode.ChoosePrompt
    ) {
      return 'Search for cards';
    }
    return 'Search for…';
  }

  getCard = restartableTask(async (cardURL: string) => {
    let response = await this.loaderService.loader.fetch(cardURL, {
      headers: {
        Accept: 'application/vnd.card+json',
      },
    });
    if (response.ok) {
      let maybeCardDoc = await response.json();
      if (isSingleCardDocument(maybeCardDoc)) {
        let card = await this.cardService.createFromSerialized(
          maybeCardDoc.data,
          maybeCardDoc,
          new URL(maybeCardDoc.data.id),
        );
        this.args.onCardSelect(card);
        this.resetState();
        this.args.onCancel();
        return;
      }
    }
    this.hasCardURLError = true;
  });

  @action
  onCancel() {
    this.resetState();
    this.args.onCancel();
  }

  @action
  setCardURL(cardURL: string) {
    this.hasCardURLError = false;
    this.cardURL = cardURL;
  }

  @action
  onURLFieldKeypress(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.getCard.perform(this.cardURL);
    }
  }

  @action
  onGo() {
    // load card if URL field is populated, otherwise perform search if search term specified
    if (this.cardURL) {
      this.getCard.perform(this.cardURL);
    }
  }

  resetState() {
    this.searchKey = '';
    this.cardURL = '';
    this.hasCardURLError = false;
    this.searchCardResults.splice(0, this.searchCardResults.length);
  }

  @cached
  get orderedRecentCards() {
    // Most recently added first
    return [...this.operatorModeStateService.recentCards].reverse();
  }

  debouncedSearchFieldUpdate = debounce(() => {
    if (!this.searchKey) {
      this.searchCardResults.splice(0, this.searchCardResults.length);
      this.isSearching = false;
      return;
    }
    this.onSearchFieldUpdated();
  }, 500);

  @action
  onSearchFieldUpdated() {
    if (this.searchKey) {
      this.searchCardResults.splice(0, this.searchCardResults.length);
      this.searchCard.perform(this.searchKey);
    }
  }

  @action
  setSearchKey(searchKey: string) {
    this.searchKey = searchKey;
    this.isSearching = true;
    this.debouncedSearchFieldUpdate();
    this.args.onSearch?.(searchKey);
  }

  private searchCard = restartableTask(async (searchKey: string) => {
    let query = {
      filter: {
        every: [
          {
            not: {
              type: catalogEntryRef,
            },
          },
          {
            contains: {
              title: searchKey,
            },
          },
        ],
      },
    };

    let cards = flatMap(
      await Promise.all(
        [
          this.cardService.defaultURL.href,
          baseRealm.url,
          ...otherRealmURLs,
        ].map(
          async (realm) => await this.cardService.search(query, new URL(realm)),
        ),
      ),
    );

    if (cards.length > 0) {
      this.searchCardResults.push(...cards);
    } else {
      this.searchCardResults.splice(0, this.searchCardResults.length);
    }

    this.isSearching = false;
  });

  get isSearchKeyNotEmpty() {
    return !!this.searchKey && this.searchKey !== '';
  }

  get searchInputStyle() {
    let mode = this.args.mode;
    if (mode == SearchSheetMode.Closed) {
      return htmlSafe(
        `--search-input-height: 40px; --search-input-font-size: var(--boxel-font-size-sm)`,
      );
    }
    return htmlSafe('');
  }

  @action onSearchInputKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.onCancel();
      (e.target as HTMLInputElement)?.blur?.();
    }
  }

  <template>
    <div class='search-sheet {{this.sheetSize}}' data-test-search-sheet>
      <SearchInput
        @bottomTreatment={{this.inputBottomTreatment}}
        @value={{this.searchKey}}
        @placeholder={{this.placeholderText}}
        @onFocus={{@onFocus}}
        @onInput={{this.setSearchKey}}
        {{on 'keydown' this.onSearchInputKeyDown}}
        class='search-input'
        style={{this.searchInputStyle}}
      />
      <div class='search-sheet-content'>
        {{! @glint-ignore Argument of type 'string' is not assignable to parameter of type 'boolean' }}
        {{#if
          (or (gt this.searchCardResults.length 0) this.isSearchKeyNotEmpty)
        }}
          <div class='search-result-section'>
            {{#if this.isSearching}}
              <Label data-test-search-label>Searching for "{{this.searchKey}}"</Label>
            {{else}}
              <Label
                data-test-search-result-label
              >{{this.searchCardResults.length}}
                Results for "{{this.searchKey}}"</Label>
            {{/if}}
            <div class='search-result-section__body'>
              <div class='search-result-section__cards'>
                {{#each this.searchCardResults as |card i|}}
                  <SearchResult
                    @card={{card}}
                    @compact={{eq this.sheetSize 'prompt'}}
                    {{on 'click' (fn @onCardSelect card)}}
                    data-test-search-sheet-search-result={{i}}
                  />
                {{/each}}
              </div>
            </div>
          </div>
        {{/if}}
        {{#if (gt this.operatorModeStateService.recentCards.length 0)}}
          <div class='search-result-section'>
            <Label>Recent</Label>
            <div class='search-result-section__body'>
              <div class='search-result-section__cards'>
                {{#each this.orderedRecentCards as |card i|}}
                  <SearchResult
                    @card={{card}}
                    @compact={{eq this.sheetSize 'prompt'}}
                    {{on 'click' (fn @onCardSelect card)}}
                    data-test-search-sheet-recent-card={{i}}
                  />
                {{/each}}
              </div>
            </div>
          </div>
        {{/if}}
      </div>
      <div class='footer'>
        <div class='url-entry'>
          <div class='url-entry-field-container'>
            <Label class='label'>Enter Card URL:</Label>
            <BoxelInputValidationState
              data-test-url-field
              @placeholder='http://'
              @value={{this.cardURL}}
              @onInput={{this.setCardURL}}
              @onKeyPress={{this.onURLFieldKeypress}}
              @state={{this.cardURLFieldState}}
              @errorMessage={{this.cardURLErrorMessage}}
              class='input-group'
            />
          </div>
        </div>
        <div class='buttons'>
          <Button
            {{on 'click' this.onCancel}}
            data-test-search-sheet-cancel-button
          >Cancel</Button>
          <Button
            data-test-go-button
            @disabled={{this.isGoDisabled}}
            @kind='primary'
            {{on 'click' this.onGo}}
          >Go</Button>
        </div>
      </div>
    </div>
    <style>
      :global(:root) {
        --search-sheet-closed-height: 40px;
        --search-sheet-prompt-height: 130px;
      }

      .search-sheet {
        background-color: transparent;
        bottom: 0;
        display: flex;
        flex-direction: column;
        justify-content: stretch;
        left: 10px;
        right: 10px;
        width: calc(100% - 20px);
        position: absolute;
        transition:
          height var(--boxel-transition),
          width var(--boxel-transition),
          padding var(--boxel-transition);
      }

      .search-input {
        border-radius: var(--boxel-border-radius-xl)
          var(--boxel-border-radius-xl) 0 0;
        width: 100%;
        transition:
          height var(--boxel-transition),
          width var(--boxel-transition),
          font-size var(--boxel-transition),
          border-radius var(--boxel-transition);
      }

      .closed {
        left: 20px;
        height: calc(var(--search-sheet-closed-height) + 20px);
        padding: 0;
      }

      .closed .search-input {
        border-radius: var(--boxel-border-radius-xl);
        height: var(--search-sheet-closed-height);
        width: 172px;
      }

      .prompt {
        height: var(--search-sheet-prompt-height);
      }

      .results {
        height: calc(100% - 10px);
      }

      .footer {
        align-items: center;
        background: var(--boxel-light);
        display: flex;
        flex-shrink: 0;
        justify-content: space-between;
        opacity: 1;
        height: 40px;
        padding: var(--boxel-sp-xl) var(--boxel-sp) var(--boxel-sp-lg)
          var(--boxel-sp);
        transition:
          flex var(--boxel-transition),
          opacity calc(var(--boxel-transition) / 4);
      }

      .prompt .footer {
        height: 0;
        padding: 0;
      }

      .closed .search-sheet-content,
      .closed .footer,
      .prompt .footer {
        opacity: 0;
      }
      .search-sheet-content {
        background-color: var(--boxel-light);
        border-bottom: 1px solid var(--boxel-200);
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow-y: scroll;
        padding: 0 var(--boxel-sp-lg);
        transition: opacity calc(var(--boxel-transition) / 4);
      }
      .results .search-sheet-content {
        padding-top: var(--boxel-sp);
      }
      .search-result-section {
        display: flex;
        flex-direction: column;
        width: 100%;
      }
      .prompt .search-result-section {
        flex-direction: row;
        align-items: center;
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
        padding: var(--boxel-sp-xxs);
        gap: var(--boxel-sp-xs);
      }

      .url-entry {
        flex: 2;
        margin-right: var(--boxel-sp);
      }

      .url-entry-field-container {
        display: flex;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }
      .url-entry-field-container .label {
        font-size: var(--boxel-font-size-xs);
        width: max-content;
      }
      .url-entry-field-container .input-group {
        flex: 1;
      }
    </style>
  </template>
}
