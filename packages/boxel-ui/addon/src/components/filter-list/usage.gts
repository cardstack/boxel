import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import FilterList, {
  type Filter,
  type FilterListIconSignature,
} from './index.gts';

const Captions: TemplateOnlyComponent<FilterListIconSignature> = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='24'
    height='24'
    fill='none'
    stroke='currentColor'
    stroke-linecap='round'
    stroke-linejoin='round'
    stroke-width='2'
    class='lucide lucide-captions'
    viewBox='0 0 24 24'
    ...attributes
  ><rect width='18' height='14' x='3' y='5' rx='2' ry='2' /><path
      d='M7 15h4m4 0h2M7 11h2m4 0h4'
    /></svg>
</template>;

const Stack2: TemplateOnlyComponent<FilterListIconSignature> = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='24'
    height='24'
    fill='none'
    stroke='currentColor'
    stroke-linecap='round'
    stroke-linejoin='round'
    stroke-width='2'
    class='icon icon-tabler icons-tabler-outline icon-tabler-stack-2'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path
      d='M12 4 4 8l8 4 8-4-8-4M4 12l8 4 8-4M4 16l8 4 8-4'
    /></svg>
</template>;

export default class FilterListUsage extends Component {
  private allItems = ['Author', 'BlogPost', 'Friend', 'Person', 'Pet'];
  @tracked private activeFilter: Filter = this.filters[0]!;

  @cached
  private get filters() {
    let _filters = [
      {
        displayName: 'All Items',
        icon: Stack2,
      },
    ];
    this.allItems.forEach((item) => {
      _filters.push({
        displayName: item,
        icon: Captions,
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
          @description='An array of Filters, where the Filter interface requires only displayName and icon properties.'
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
    <style scoped>
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
