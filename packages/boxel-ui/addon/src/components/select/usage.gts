import { A } from '@ember/array';
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

export default class BoxelSelectUsage extends Component {
  @tracked items = A(
    [...new Array(10)].map((_, idx) => `Item - ${idx}`),
  ) as Array<any>;

  @tracked selectedItem: string | null = null;
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

  @action onSelectItem(item: string | null): void {
    this.selectedItem = item;
  }

  <template>
    <FreestyleUsage @name='Select'>
      <:example>
        <style
          unscoped
        >
          .boxel-select-usage-dropdown {
            --boxel-select-current-color: {{this.boxelSelectCurrentColor.value}};
            --boxel-select-selected-color: {{this.boxelSelectSelectedColor.value}};
            --boxel-select-below-transitioning-in-animation: {{this.boxelSelectBelowTransitioningInAnimation.value}};
            --boxel-select-above-transitioning-in-animation: {{this.boxelSelectAboveTransitioningInAnimation.value}};
          }
        </style>
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
          @dropdownClass='boxel-select-usage-dropdown'
          aria-label='Select an item'
          as |item itemCssClass|
        >
          <div class={{itemCssClass}}>{{item}}</div>
        </BoxelSelect>
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='options'
          @description='An array of items, to be listed on dropdown'
          @required={{true}}
          @items={{this.items}}
          @onChange={{fn (mut this.items)}}
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
        <Args.Yield
          @name='itemCssClass'
          @description='Class to be set on item wrapper to add default styles'
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
        <Args.String
          @name='verticalPosition'
          @defaults='auto'
          @options={{array 'auto' 'above' 'below'}}
          @onInput={{fn (mut this.verticalPosition)}}
          @description='The vertical positioning strategy of the content'
        />
        <Args.Bool
          @name='renderInPlace'
          @defaults={{false}}
          @onInput={{fn (mut this.renderInPlace)}}
          @description='When passed true, the content will render next to the trigger instead of being placed in the root of the body'
        />
        <Args.Bool
          @name='disabled'
          @defaults={{false}}
          @onInput={{fn (mut this.disabled)}}
          @description='When truthy the component cannot be interacted'
        />
        <Args.String
          @name='searchField'
          @onInput={{fn (mut this.searchField)}}
          @description='Tells the component what property of the options should be used to filter
'
        />
        <Args.String
          @name='dropdownClass'
          @description='Class to be applied to the dropdown only'
        />
        <Args.Object
          @name='triggerComponent'
          @description='The component to rended as content instead of the default trigger component'
        />
        <Args.Object
          @name='selectedItemComponent'
          @description='The component to render to customize just the selected item of the trigger'
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
