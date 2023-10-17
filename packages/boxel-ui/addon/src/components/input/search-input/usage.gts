import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import type { InputValidationState } from '../validation-state/index.gts';
import SearchInput, { SearchInputBottomTreatment } from './index.gts';

const validBottomTreatments = Object.values(SearchInputBottomTreatment);

export default class SearchInputUsage extends Component {
  defaultBottomTreatment = SearchInputBottomTreatment.Rounded;
  @tracked bottomTreatment = this.defaultBottomTreatment;
  @tracked value = '';
  @tracked errorMessage = '';
  @tracked placeholder = 'Boxel search input with validation.';
  @tracked state: InputValidationState = 'initial';

  @action onFocus() {
    console.log('onFocus called');
  }
  @action onInput(val: string) {
    this.value = val;
  }
  @action onKeyPress() {
    console.log('onKeyPress called');
  }

  <template>
    {{! template-lint-disable no-inline-styles }}
    <FreestyleUsage @name='SearchInput'>
      <:description>
        Boxel search input with validation.
      </:description>
      <:example>
        <SearchInput
          @value={{this.value}}
          @bottomTreatment={{this.bottomTreatment}}
          @state={{this.state}}
          @errorMessage={{this.errorMessage}}
          @placeholder={{this.placeholder}}
          @onFocus={{this.onFocus}}
          @onInput={{this.onInput}}
          @onKeyPress={{this.onKeyPress}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @description='The text value of the input'
          @onInput={{fn (mut this.value)}}
          @value={{this.value}}
        />
        <Args.String
          @name='bottomTreatment'
          @description='The visual shape of the bottom of the input'
          @onInput={{fn (mut this.bottomTreatment)}}
          @options={{validBottomTreatments}}
          @value={{this.bottomTreatment}}
          @defaultValue={{this.defaultBottomTreatment}}
        />
        <Args.Action
          @name='onFocus'
          @description='Action to call when the input gains focus'
        />
        <Args.Action
          @name='onInput'
          @description='Action to call when the input value changes'
        />
        <Args.Action
          @name='onKeyPress'
          @description='Action to call on key press'
        />
        <Args.String
          @name='placeholder'
          @description='Placeholder text'
          @onInput={{fn (mut this.placeholder)}}
          @value={{this.placeholder}}
          @defaultValue='Search'
        />
        <Args.String
          @name='state'
          @description='Validation state'
          @options={{Array 'valid' 'invalid' 'loading' 'initial'}}
          @defaultValue='initial'
          @onInput={{fn (mut this.state)}}
          @value={{this.state}}
        />
        <Args.String
          @name='errorMessage'
          @description='Error message'
          @onInput={{fn (mut this.errorMessage)}}
          @value={{this.errorMessage}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
