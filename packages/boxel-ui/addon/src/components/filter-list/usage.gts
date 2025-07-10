import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import Card from '../../icons/card.gts';
import File from '../../icons/file.gts';
import Star from '../../icons/star.gts';
import FilterList, { type Filter } from './index.gts';

export default class FilterListUsage extends Component {
  private nestedItems = ['Author', 'BlogPost', 'Friend', 'Person', 'Pet'];
  private items = [
    {
      displayName: 'Highlights',
      icon: File,
      filters: [
        {
          displayName: 'Category 1',
        },
        {
          displayName: 'Category 2',
          filters: [
            {
              displayName: 'Item 1',
              icon: Star,
            },
            {
              displayName: 'Item 2',
            },
          ],
        },
        {
          displayName: 'Category 3',
        },
      ],
    },
    {
      displayName: 'Recent',
      icon: File,
    },
    {
      displayName: 'All Cards',
      icon: Card,
      filters: [],
    },
    {
      displayName: 'Starred',
      icon: Star,
    },
  ];
  @tracked private activeFilter: Filter | undefined = this.filters?.[0];

  private get filters(): Filter[] {
    let _filters: Filter[] = this.items;
    this.nestedItems.forEach((item) => {
      _filters[2]!['filters']!.push({
        displayName: item,
        icon: File,
      });
    });
    return _filters;
  }

  private onChange = (filter: Filter) => (this.activeFilter = filter);

  <template>
    <FreestyleUsage @name='Filter List'>
      <:example>
        <div class='filter-usage'>
          <FilterList
            @filters={{this.filters}}
            @activeFilter={{this.activeFilter}}
            @onChanged={{this.onChange}}
          />
          <h2>{{this.activeFilter.displayName}}</h2>
        </div>
      </:example>

      <:api as |Args|>
        <Args.Object
          @name='filters'
          @description='An array of objects of type Filter, where the displayName property is required.'
          @value={{this.filters}}
          @defaultValue='[]'
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
    <style scoped>
      .filter-usage {
        display: grid;
        grid-template-columns: 250px 1fr;
        gap: var(--boxel-sp-sm);
      }
    </style>
  </template>
}
