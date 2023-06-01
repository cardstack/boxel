import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import SearchInput, { SearchInputBottomTreatment } from './index';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

const validBottomTreatments = Object.values(SearchInputBottomTreatment);

export default class SearchInputUsage extends Component {
  defaultBottomTreatment = SearchInputBottomTreatment.Flat;
  @tracked bottomTreatment = SearchInputBottomTreatment.Flat;
  @tracked value = '';
  @action onFocus() {
    console.log('onFocus called');
  }
  @action onInput(val: string) {
    this.value = val;
  }

  <template>
    {{! template-lint-disable no-inline-styles }}
    <FreestyleUsage @name='SearchInput'>
      <:description>
        Boxel operator mode search bar.
      </:description>
      <:example>
        <SearchInput
          @bottomTreatment={{this.bottomTreatment}}
          @value={{this.value}}
          @onFocus={{this.onFocus}}
          @onInput={{this.onInput}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='bottomTreatment'
          @description='The visual shape of the bottom of the input'
          @onInput={{fn (mut this.bottomTreatment)}}
          @options={{validBottomTreatments}}
          @value={{this.bottomTreatment}}
          @defaultValue={{this.defaultBottomTreatment}}
        />
        <Args.String
          @name='value'
          @description='The text value of the input'
          @onInput={{fn (mut this.value)}}
          @value={{this.value}}
        />
        <Args.Action
          @name='onFocus'
          @description='Action to call when the input gains focus'
        />
        <Args.Action
          @name='onInput'
          @description='Action to call when the input value changes'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
