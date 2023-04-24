import Component from '@glimmer/component';
import SearchInput, { SearchInputBottomTreatment } from './search-input';
import { Button } from '@cardstack/boxel-ui';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { action } from '@ember/object';

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
    return !Boolean(this.searchInputValue);
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
    <div class='search-sheet search-sheet--{{this.sheetSize}}'>
      <div class='search-sheet-header'>
        <div class='search-sheet-headline'>
          {{this.headline}}
        </div>
        <div class='search-sheet-controls'>
          {{! Controls here }}
        </div>
      </div>
      <SearchInput
        @bottomTreatment={{this.inputBottomTreatment}}
        @value={{this.searchInputValue}}
        @onFocus={{@onFocus}}
        @onInput={{fn (mut this.searchInputValue)}}
      />
      <div class='search-sheet-footer'>
        <div class='search-sheet-url-entry'>
          {{! Enter Card URL: .... }}
        </div>
        <div class='search-sheet-buttons'>
          <Button {{on 'click' this.onCancel}}>Cancel</Button>
          <Button
            @disabled={{this.isSearchDisabled}}
            @kind='primary'
          >Search</Button>
        </div>
      </div>
    </div>
  </template>
}
