import Component from '@glimmer/component';
import SearchInput, { SearchInputBottomTreatment } from './search-input';
import { Button } from '@cardstack/boxel-ui';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import SearchResult from './search-result';
import { Label } from '@cardstack/boxel-ui';
import { Card } from 'https://cardstack.com/base/card-api';
import { gt } from '../../helpers/truth-helpers';
import { reverse } from '../../helpers/array-helpers';

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
    recentCards: Card[];
  };
  Blocks: {};
}

export default class SearchSheet extends Component<Signature> {
  @tracked searchInputValue = '';

  get inputBottomTreatment() {
    return this.args.mode == SearchSheetMode.Closed
      ? SearchInputBottomTreatment.Flat
      : SearchInputBottomTreatment.Rounded;
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

  get isSearchDisabled() {
    return !this.searchInputValue;
  }

  // This funky little gymnastics has the effect of leaving the headline along when closing the sheet, to improve the animation
  _headline = 'Search cards and workspaces';
  get headline() {
    let mode = this.args.mode;
    if (
      mode == SearchSheetMode.ChoosePrompt ||
      mode == SearchSheetMode.ChooseResults
    ) {
      this._headline = 'Open a card or workspace';
    } else if (
      mode == SearchSheetMode.SearchPrompt ||
      mode == SearchSheetMode.SearchResults
    ) {
      this._headline = 'Search cards and workspaces';
    }
    return this._headline;
  }

  @action
  onCancel() {
    this.searchInputValue = '';
    this.args.onCancel();
  }

  <template>
    <div class='search-sheet {{this.sheetSize}}'>
      <div class='header'>
        <div class='headline'>
          {{this.headline}}
        </div>
        <div class='controls'>
          {{! Controls here }}
        </div>
      </div>
      <SearchInput
        @bottomTreatment={{this.inputBottomTreatment}}
        @value={{this.searchInputValue}}
        @onFocus={{@onFocus}}
        @onInput={{fn (mut this.searchInputValue)}}
        data-test-search-sheet
      />
      <div class='search-sheet-content'>
        {{#if (gt @recentCards.length 0)}}
          <div class='search-sheet-content__recent-access'>
            <Label>Recent</Label>
            <div class='search-sheet-content__recent-access__body'>
              <div class='search-sheet-content__recent-access__cards'>
                {{#each (reverse @recentCards) as |card| }}
                  <SearchResult @card={{card}}/>
                {{/each}}
              </div>
            </div>
          </div>
        {{/if}}
      </div>
      <div class='footer'>
        <div class='url-entry'>
          {{! Enter Card URL: .... }}
        </div>
        <div class='buttons'>
          <Button {{on 'click' this.onCancel}}>Cancel</Button>
          <Button
            @disabled={{this.isSearchDisabled}}
            @kind='primary'
          >Search</Button>
        </div>
      </div>
    </div>
    <style>
      :global(:root) {
        --search-sheet-closed-height: 59px;
      }

      .search-sheet {
        background: #fff;
        border-radius: 20px 20px 0 0;
        bottom: -1px;
        box-shadow: 0 5px 15px 0 rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        left: 3.5%;
        position: absolute;
        transition: height var(--boxel-transition), padding var(--boxel-transition);
        width: 93%;
      }

      .closed {
        height: var(--search-sheet-closed-height);
        padding: 0;
      }

      .prompt {
        padding: 30px 40px;
      }

      .results {
        height: 300px;
        padding: 30px 40px;
      }

      .header,
      .footer {
        align-items: center;
        display: flex;
        flex: 1;
        justify-content: space-between;
        opacity: 1;
        transition: flex var(--boxel-transition), opacity var(--boxel-transition);
      }

      .closed .header,
      .closed .footer {
        flex: 0;
        opacity: 0;
      }

      .header {
        height: 37px;
        overflow: hidden;
      }

      .headline {
        font-family: Poppins;
        font-size: 22px;
        font-weight: bold;
        font-stretch: normal;
        font-style: normal;
        line-height: 0.91;
        letter-spacing: 0.22px;
        color: #000;
      }

      .footer {
        height: 40px;
        overflow: hidden;
      }

      .search-sheet-content { display: flex; flex-direction: column; }
      .search-sheet-content__recent-access { display: flex; flex-direction: column; padding: var(--boxel-sp); width: 100%; }
      .search-sheet-content__recent-access .boxel-label {
        font: 700 var(--boxel-font);
      }
      .search-sheet-content__recent-access__body {
        overflow: auto;
      }
      .search-sheet-content__recent-access__cards { 
        display: flex; 
        flex-direction: row;
        width: min-content; 
        padding: var(--boxel-sp) var(--boxel-sp-xxxs);
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}
