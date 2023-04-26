import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import SearchBar from './index';

export default class SearchBarUsage extends Component {
  <template>
    {{! template-lint-disable no-inline-styles }}
    <FreestyleUsage @name='SearchBar'>
      <:description>
        Boxel operator mode search bar.
      </:description>
      <:example>
        <SearchBar />
      </:example>
      {{! <:api as |Args|>
      </:api> }}
    </FreestyleUsage>
  </template>
}
