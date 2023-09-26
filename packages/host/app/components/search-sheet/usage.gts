import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import SearchSheet, { SearchSheetMode } from './index';

const validModes = Object.values(SearchSheetMode);

export default class SearchSheetUsage extends Component {
  defaultMode: SearchSheetMode = SearchSheetMode.Closed;
  @tracked mode: SearchSheetMode = SearchSheetMode.Closed;

  @action onFocus() {
    if (this.mode == SearchSheetMode.Closed) {
      this.mode = SearchSheetMode.SearchPrompt;
    }
  }

  @action onBlur() {
    this.mode = SearchSheetMode.Closed;
  }

  @action onCancel() {
    this.mode = SearchSheetMode.Closed;
  }

  @action onSearch(_term: string) {
    // noop
  }

  @action onCardSelect() {
    // noop
  }

  <template>
    <FreestyleUsage @name='SearchSheet'>
      <:description>
        Boxel operator mode search sheet.
      </:description>
      <:example>
        <div class='example-container'>
          <SearchSheet
            @mode={{this.mode}}
            @onCancel={{this.onCancel}}
            @onFocus={{this.onFocus}}
            @onBlur={{this.onBlur}}
            @onSearch={{this.onSearch}}
            @onCardSelect={{this.onCardSelect}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='mode'
          @description='The mode of the sheet'
          @onInput={{fn (mut this.mode)}}
          @options={{validModes}}
          @value={{this.mode}}
          @defaultValue={{this.defaultMode}}
        />
        <Args.Action
          @name='onCancel'
          @description='Action to call when the user cancels search'
        />
        <Args.Action
          @name='onFocus'
          @description='Action to call when the user focuses the search input'
        />
        <Args.Action
          @name='onSearch'
          @description='Action to call when the user issues a search'
        />
        <Args.Action
          @name='onCardSelect'
          @description='Action to call when the user clicks on a card in the search results'
        />
      </:api>
    </FreestyleUsage>
    <style>
      .example-container {
        background: #494559;
        min-height: 300px;
        overflow: hidden;
        position: relative;
      }
    </style>
  </template>
}
