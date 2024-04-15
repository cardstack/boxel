import { array, fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import BoxelSelect from './index.gts';

interface Country {
  name: string;
}

export default class BoxelSelectUsage extends Component {
  @tracked items = [
    { name: 'United States' },
    { name: 'Spain' },
    { name: 'Portugal' },
    { name: 'Russia' },
    { name: 'Latvia' },
    { name: 'Brazil' },
    { name: 'United Kingdom' },
  ] as Array<Country>;

  @tracked selectedItem: string | null = null;
  @tracked placeholder = 'Select Item';
  @tracked verticalPosition = 'auto' as const;

  @tracked renderInPlace = true;
  @tracked disabled = false;
  @tracked searchField = '';
  @tracked searchEnabled = false;
  @tracked multipleSelection = false;

  get itemNames() {
    return this.items.map((item) => {
      return item.name ?? '';
    });
  }

  @cssVariable({ cssClassName: '__GLIMMER_SCOPED_CSS_CLASS' })
  declare boxelSelectCurrentColor: CSSVariableInfo;
  @cssVariable({ cssClassName: '__GLIMMER_SCOPED_CSS_CLASS' })
  declare boxelSelectSelectedColor: CSSVariableInfo;
  @cssVariable({ cssClassName: '__GLIMMER_SCOPED_CSS_CLASS' })
  declare boxelSelectBelowTransitioningInAnimation: CSSVariableInfo;
  @cssVariable({ cssClassName: '__GLIMMER_SCOPED_CSS_CLASS' })
  declare boxelSelectAboveTransitioningInAnimation: CSSVariableInfo;

  @action onSelectItem(item: string | null): void {
    this.selectedItem = item;
  }

  <template>
    <style
      unscoped
    >
          .boxel-select-usage {
            --boxel-select-current-color: {{this.boxelSelectCurrentColor.value}};;
            --boxel-select-selected-color: {{this.boxelSelectSelectedColor.value}};
          };
        </style>
    <FreestyleUsage @name='Select'>
      <:example>
        <BoxelSelect
          {{!-- @multipleSelection={{this.multipleSelection}} --}}
          @placeholder={{this.placeholder}}
          @searchEnabled={{this.searchEnabled}}
          @searchField={{this.searchField}}
          @selected={{this.selectedItem}}
          @onChange={{this.onSelectItem}}
          @options={{this.itemNames}}
          @verticalPosition={{this.verticalPosition}}
          @renderInPlace={{this.renderInPlace}}
          @disabled={{this.disabled}}
          @dropdownClass={{'boxel-select-usage'}}
          aria-label='Select an item'
          as |item|
        >
          <div>{{item}}</div>
        </BoxelSelect>
      </:example>
      <:api as |Args|>

        <Args.Object
          @name='selected'
          @description='Selected item, its type is dependent on items'
          @value={{this.selectedItem}}
          @onInput={{this.onSelectItem}}
          @optional={{true}}
        />

        <Args.String
          @name='placeholder'
          @description='Placeholder for trigger component'
          @value={{this.placeholder}}
          @onInput={{fn (mut this.placeholder)}}
        />
        <Args.Bool
          @name='searchEnabled'
          @description='True to show a search box at the top of the list of items'
          @value={{this.searchEnabled}}
          @onInput={{fn (mut this.searchEnabled)}}
        />
        <Args.Bool
          @name='multipleSelection'
          @description='Enable selecting more than one option'
          @value={{this.multipleSelection}}
          @onInput={{fn (mut this.multipleSelection)}}
          @defaultValue={{false}}
        />
        <Args.String
          @name='verticalPosition'
          @defaultValue='auto'
          @value={{this.verticalPosition}}
          @options={{array 'auto' 'above' 'below'}}
          @onInput={{fn (mut this.verticalPosition)}}
          @description='The vertical positioning strategy of the content'
        />
        <Args.Bool
          @name='renderInPlace'
          @defaultValue={{true}}
          @value={{this.renderInPlace}}
          @onInput={{fn (mut this.renderInPlace)}}
          @description='When passed true, the content will render next to the trigger instead of being placed in the root of the body'
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{fn (mut this.disabled)}}
          @description='When truthy the component cannot be interacted'
        />

      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-select-current-color'
          @type='color'
          @defaultValue={{this.boxelSelectCurrentColor.defaults}}
          @value={{this.boxelSelectCurrentColor.value}}
          @onInput={{this.boxelSelectCurrentColor.update}}
        />
        <Css.Basic
          @name='boxel-select-selected-color'
          @type='color'
          @defaultValue={{this.boxelSelectSelectedColor.defaults}}
          @value={{this.boxelSelectSelectedColor.value}}
          @onInput={{this.boxelSelectSelectedColor.update}}
        />
      </:cssVars>
    </FreestyleUsage>
  </template>
}
