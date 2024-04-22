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

  @tracked selectedItem: Country | null = null;
  @tracked placeholder = 'Select Item';
  @tracked verticalPosition = 'auto' as const;

  @tracked renderInPlace = false;
  @tracked disabled = false;
  @tracked searchField = '';
  @tracked searchEnabled = false;

  @cssVariable({ cssClassName: 'boxel-select__dropdown' })
  declare boxelSelectCurrentColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'boxel-select__dropdown' })
  declare boxelSelectSelectedColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'boxel-select__dropdown' })
  declare boxelSelectBelowTransitioningInAnimation: CSSVariableInfo;
  @cssVariable({ cssClassName: 'boxel-select__dropdown' })
  declare boxelSelectAboveTransitioningInAnimation: CSSVariableInfo;

  @action onSelectItem(item: Country | null): void {
    this.selectedItem = item;
  }

  <template>
    <style
    >
          :global(.boxel-select-usage) {
            --boxel-select-current-color: {{this.boxelSelectCurrentColor.value}};
            --boxel-select-selected-color: {{this.boxelSelectSelectedColor.value}};
            --boxel-select-below-transitioning-in-animation: {{this.boxelSelectBelowTransitioningInAnimation.value}};
            --boxel-select-above-transitioning-in-animation: {{this.boxelSelectAboveTransitioningInAnimation.value}};
          }
        </style>
    <FreestyleUsage @name='Select'>
      <:example>

        <BoxelSelect
          @placeholder={{this.placeholder}}
          @searchEnabled={{this.searchEnabled}}
          @searchField={{this.searchField}}
          @selected={{this.selectedItem}}
          @onChange={{this.onSelectItem}}
          @options={{this.items}}
          @verticalPosition={{this.verticalPosition}}
          @renderInPlace={{this.renderInPlace}}
          @disabled={{this.disabled}}
          @dropdownClass='boxel-select-usage'
          aria-label={{this.placeholder}}
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='options'
          @description='An array of items, to be listed on dropdown'
          @required={{true}}
          @items={{this.items}}
          @onChange={{this.onSelectItem}}
        />
        <Args.Action
          @name='onChange'
          @description='Invoke this action to close handle selected item'
          @required={{true}}
        />
        <Args.Object
          @name='selected'
          @description='Selected item, its type is dependent on items'
          @required={{true}}
        />
        <Args.Yield
          @name='item'
          @description='Item to be presented on dropdown'
        />
        <Args.String
          @name='placeholder'
          @description='Placeholder for trigger component'
          @value={{this.placeholder}}
          @onInput={{fn (mut this.placeholder)}}
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
          @defaultValue={{false}}
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
        <Args.Bool
          @name='searchEnabled'
          @description='True to show a search box at the top of the list of items'
          @value={{this.searchEnabled}}
          @onInput={{fn (mut this.searchEnabled)}}
        />
        <Args.String
          @name='searchField'
          @onInput={{fn (mut this.searchField)}}
          @description='Tells the component what property of the options should be used to filter'
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
        <Css.Basic
          @name='boxel-select-below-transitioning-in-animation'
          @type='transition'
          @description='Animation for dropdown appearing below. On close animation is reversed'
          @defaultValue={{this.boxelSelectBelowTransitioningInAnimation.defaults}}
          @value={{this.boxelSelectBelowTransitioningInAnimation.value}}
          @onInput={{this.boxelSelectBelowTransitioningInAnimation.update}}
        />
        <Css.Basic
          @name='boxel-select-above-transitioning-in-animation'
          @type='transition'
          @description='Animation for dropdown appearing above. On close animation is reversed'
          @defaultValue={{this.boxelSelectAboveTransitioningInAnimation.defaults}}
          @value={{this.boxelSelectAboveTransitioningInAnimation.value}}
          @onInput={{this.boxelSelectAboveTransitioningInAnimation.update}}
        />
      </:cssVars>
    </FreestyleUsage>
  </template>
}
