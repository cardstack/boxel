import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import FilterList, { type Filter } from './index.gts';

export default class FilterListUsage extends Component {
  private allItems = ['Author', 'BlogPost', 'Friend', 'Person', 'Pet'];
  @tracked private activeFilter: Filter = this.filters[0]!;

  @cached
  private get filters() {
    let _filters = [
      {
        displayName: 'All Items',
      },
    ];
    this.allItems.forEach((item) => {
      _filters.push({
        displayName: item,
      });
    });

    return _filters;
  }

  @cached
  private get items() {
    if (this.activeFilter.displayName === 'All Items') {
      return this.allItems;
    }

    return this.allItems.filter(
      (item) => item === this.activeFilter.displayName,
    );
  }

  <template>
    <FreestyleUsage @name='Filter List'>
      <:example>
        <div class='filter-usage'>
          <FilterList
            @filters={{this.filters}}
            @activeFilter={{this.activeFilter}}
            @onChanged={{fn (mut this.activeFilter)}}
          />
          <div class='items'>
            {{#each this.items as |item|}}
              <span class='item'>
                {{item}}
              </span>
            {{/each}}
          </div>
        </div>
      </:example>

      <:api as |Args|>
        <Args.Object
          @name='filters'
          @description='An array of Filters, where the Filter interface requires only a \`displayName\` property.'
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
    <style>
      .filter-usage {
        display: flex;
        gap: var(--boxel-sp-sm);
      }
      .items {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--boxel-sp-xs);
      }
      .item {
        padding: var(--boxel-sp-xs);
        border-radius: 6px;
        border: 2px solid var(--boxel-400);
        height: fit-content;
      }
    </style>
  </template>
}
