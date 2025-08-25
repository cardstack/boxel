import { array, fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { cssVar } from '../../helpers.ts';
import BoxelField from '../field-container/index.gts';
import BoxelSelect from './index.gts';

interface Country {
  name: string;
}

export default class BoxelSelectUsage extends Component {
  selectVariants = ['default', 'primary', 'secondary', 'muted', 'destructive'];
  selectVariantDefault:
    | undefined
    | 'primary'
    | 'secondary'
    | 'muted'
    | 'destructive'
    | 'default' = undefined;

  @tracked items = [
    { name: 'United States' },
    { name: 'Spain' },
    { name: 'Portugal' },
    { name: 'Russia' },
    { name: 'Latvia' },
    { name: 'Brazil' },
    { name: 'United Kingdom' },
  ] as Array<Country>;

  get displayItems() {
    return this.items.map((item) => item.name);
  }

  @tracked selectedItem: Country | null = null;
  @tracked placeholder = 'Select Item';
  @tracked verticalPosition = 'auto' as const;
  @tracked variant:
    | undefined
    | 'primary'
    | 'secondary'
    | 'muted'
    | 'destructive'
    | 'default' = undefined;

  @tracked renderInPlace = false;
  @tracked disabled = false;
  @tracked searchField = '';
  @tracked searchEnabled = false;
  @tracked matchTriggerWidth = true;

  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelSelectBackgroundColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelSelectBorderColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelSelectTextColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelSelectPlaceholderColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelSelectFocusBorderColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelDropdownBackgroundColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelDropdownBorderColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelDropdownTextColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelDropdownHighlightColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelDropdownHighlightHoverColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelDropdownHoverColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelDropdownFocusBorderColor: CSSVariableInfo;

  @action onSelectItem(item: Country | null): void {
    this.selectedItem = item;
  }

  <template>
    <div
      class='header-freestyle-container'
      style={{cssVar
        boxel-select-background-color=this.boxelSelectBackgroundColor.value
        boxel-select-border-color=this.boxelSelectBorderColor.value
        boxel-select-text-color=this.boxelSelectTextColor.value
        boxel-select-placeholder-color=this.boxelSelectPlaceholderColor.value
        boxel-select-focus-border-color=this.boxelSelectFocusBorderColor.value
        boxel-dropdown-background-color=this.boxelDropdownBackgroundColor.value
        boxel-dropdown-border-color=this.boxelDropdownBorderColor.value
        boxel-dropdown-text-color=this.boxelDropdownTextColor.value
        boxel-dropdown-highlight-color=this.boxelDropdownHighlightColor.value
        boxel-dropdown-highlight-hover-color=this.boxelDropdownHighlightHoverColor.value
        boxel-dropdown-hover-color=this.boxelDropdownHoverColor.value
        boxel-dropdown-focus-border-color=this.boxelDropdownFocusBorderColor.value
      }}
    >
      <FreestyleUsage @name='Select'>
        <:description>
          Select components allow users to choose from a list of options. They
          support theme variants and customizable styling with search
          functionality.
        </:description>
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
            @variant={{this.variant}}
            @dropdownClass='boxel-select-usage'
            @matchTriggerWidth={{this.matchTriggerWidth}}
            aria-label={{this.placeholder}}
            data-test-select-freestyle-usage
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
            @items={{this.displayItems}}
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
            @name='variant'
            @optional={{true}}
            @description='Theme-based variant for consistent styling'
            @defaultValue={{this.selectVariantDefault}}
            @options={{this.selectVariants}}
            @onInput={{fn (mut this.variant)}}
            @value={{this.variant}}
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
            @name='matchTriggerWidth'
            @defaultValue={{true}}
            @value={{this.matchTriggerWidth}}
            @onInput={{fn (mut this.matchTriggerWidth)}}
            @description='Allow dropdown width to match trigger width'
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
            @defaultValue={{false}}
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
            @name='boxel-select-background-color'
            @type='color'
            @description='Global override for select background color (highest priority)'
            @value={{this.boxelSelectBackgroundColor.value}}
            @onInput={{this.boxelSelectBackgroundColor.update}}
          />
          <Css.Basic
            @name='boxel-select-border-color'
            @type='color'
            @description='Global override for select border color (highest priority)'
            @value={{this.boxelSelectBorderColor.value}}
            @onInput={{this.boxelSelectBorderColor.update}}
          />
          <Css.Basic
            @name='boxel-select-text-color'
            @type='color'
            @description='Global override for select text color (highest priority)'
            @value={{this.boxelSelectTextColor.value}}
            @onInput={{this.boxelSelectTextColor.update}}
          />
          <Css.Basic
            @name='boxel-select-focus-border-color'
            @type='color'
            @description='Global override for select focus border color (highest priority)'
            @value={{this.boxelSelectFocusBorderColor.value}}
            @onInput={{this.boxelSelectFocusBorderColor.update}}
          />
          <Css.Basic
            @name='boxel-dropdown-background-color'
            @type='color'
            @description='Global override for dropdown background color (highest priority)'
            @value={{this.boxelDropdownBackgroundColor.value}}
            @onInput={{this.boxelDropdownBackgroundColor.update}}
          />
          <Css.Basic
            @name='boxel-dropdown-border-color'
            @type='color'
            @description='Global override for dropdown border color (highest priority)'
            @value={{this.boxelDropdownBorderColor.value}}
            @onInput={{this.boxelDropdownBorderColor.update}}
          />
          <Css.Basic
            @name='boxel-dropdown-text-color'
            @type='color'
            @description='Global override for dropdown text color (highest priority)'
            @value={{this.boxelDropdownTextColor.value}}
            @onInput={{this.boxelDropdownTextColor.update}}
          />
          <Css.Basic
            @name='boxel-dropdown-highlight-color'
            @type='color'
            @description='Global override for dropdown highlight color (highest priority)'
            @value={{this.boxelDropdownHighlightColor.value}}
            @onInput={{this.boxelDropdownHighlightColor.update}}
          />
          <Css.Basic
            @name='boxel-dropdown-highlight-hover-color'
            @type='color'
            @description='Global override for dropdown highlight hover color (highest priority)'
            @value={{this.boxelDropdownHighlightHoverColor.value}}
            @onInput={{this.boxelDropdownHighlightHoverColor.update}}
          />
          <Css.Basic
            @name='boxel-dropdown-hover-color'
            @type='color'
            @description='Global override for dropdown hover color (highest priority)'
            @value={{this.boxelDropdownHoverColor.value}}
            @onInput={{this.boxelDropdownHoverColor.update}}
          />
          <Css.Basic
            @name='boxel-dropdown-focus-border-color'
            @type='color'
            @description='Global override for dropdown focus border color (highest priority)'
            @value={{this.boxelDropdownFocusBorderColor.value}}
            @onInput={{this.boxelDropdownFocusBorderColor.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>

    <FreestyleUsage @name='Usage with FieldContainer'>
      <:example>
        <BoxelField @label='Country'>
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
            @variant={{this.variant}}
            @dropdownClass='boxel-select-usage'
            @matchTriggerWidth={{this.matchTriggerWidth}}
            aria-label={{this.placeholder}}
            as |item|
          >
            <div>{{item.name}}</div>
          </BoxelSelect>
        </BoxelField>
      </:example>
    </FreestyleUsage>
  </template>
}
