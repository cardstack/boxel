import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import FilterList, { type Filter } from './index.gts';

export default class FilterListUsage extends Component {
  filters = [
    {
      displayName: 'All Apps',
      query: {
        filter: {
          eq: {
            _cardType: 'Apps',
          },
        },
      },
    },
    {
      displayName: 'All Cards',
      query: {
        filter: {
          eq: {
            _cardType: 'Card',
          },
        },
      },
    },
    {
      displayName: 'Person',
      query: {
        filter: {
          eq: {
            _cardType: 'Person',
          },
        },
      },
    },
    {
      displayName: 'Pet',
      query: {
        filter: {
          eq: {
            _cardType: 'Pet',
          },
        },
      },
    },
  ];
  @tracked activeFilter: Filter = this.filters[0]!;

  <template>
    <FreestyleUsage @name='Filter List'>
      <:example>
        <FilterList
          @filters={{this.filters}}
          @activeFilter={{this.activeFilter}}
          @onChanged={{fn (mut this.activeFilter)}}
        />
      </:example>

      <:api as |Args|>
        <Args.Object
          @name='filters'
          @description='An array of Filter, where Filter type contains two fields: displayName and query.'
          @value={{this.filters}}
        />
        <Args.Object
          @name='activeFilter'
          @description='The selected filter.'
          @defaultValue='undefined'
          @value={{this.activeFilter}}
        />
        <Args.Object
          @name='onChanged'
          @description='A callback function that is triggered when a filter is selected.'
          @defaultValue='undefined'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
