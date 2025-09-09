import Card from '@cardstack/boxel-icons/card-credit';
import File from '@cardstack/boxel-icons/file';
import Star from '@cardstack/boxel-icons/star';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

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
      isExpanded: true,
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
      <:cssVars as |Css|>
        <Css.Basic
          @name='--boxel-filter-expanded-background'
          @type='background-color'
          @description='background-color for expanded list toggle button'
        />
        <Css.Basic
          @name='--boxel-filter-expanded-foreground'
          @type='color'
          @description='font color for expanded list item'
        />
        <Css.Basic
          @name='--boxel-filter-hover-background'
          @type='background-color'
          @description='hover state background-color for list button'
        />
        <Css.Basic
          @name='--boxel-filter-hover-foreground'
          @type='color'
          @description='hover state font color'
        />
        <Css.Basic
          @name='--boxel-filter-selected-background'
          @type='background-color'
          @description='selected (active) state background-color for list button'
        />
        <Css.Basic
          @name='--boxel-filter-selected-foreground'
          @type='color'
          @description='selected (active) state font color'
        />
        <Css.Basic
          @name='--boxel-filter-selected-hover-background'
          @type='background-color'
          @description='background-color for hover state of selected list button'
        />
        <Css.Basic
          @name='--boxel-filter-selected-hover-foreground'
          @type='color'
          @description='color for hover state of selected list button'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .filter-usage {
        display: grid;
        grid-template-columns: 250px 1fr;
        gap: var(--boxel-sp-sm);
      }
      :deep(.FreestyleUsageCssVar input) {
        display: none;
      }
    </style>
  </template>
}
