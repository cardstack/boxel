import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import BoxelField from '../field-container/index.gts';
import { BoxelMultiSelect } from './index.gts';

interface Country {
  name: string;
}

export default class BoxelMultiSelectUsage extends Component {
  @tracked items = [
    { name: 'United States' },
    { name: 'Spain' },
    { name: 'Portugal' },
    { name: 'Russia' },
    { name: 'Latvia' },
    { name: 'Brazil' },
    { name: 'United Kingdom' },
  ] as Array<Country>;

  @tracked selectedItems: Country[] = [];
  @tracked placeholder = 'Select countries';
  @tracked disabled = false;
  @tracked renderInPlace = false;
  @tracked matchTriggerWidth = true;
  @tracked searchEnabled = true;
  @tracked closeOnSelect = false;

  get displayItems() {
    return this.items.map((item) => item.name);
  }

  @action onSelectItems(items: Country[]): void {
    this.selectedItems = items;
  }

  <template>
    <FreestyleUsage @name='Multi Select'>
      <:description>
        <p>
          Multi Select lets users pick several options from a list. It wraps
          ember-power-select with
          <code>@multiple</code>, renders each option through its block, and
          accepts power-select's own
          <code>selectedItemComponent</code>,
          <code>triggerComponent</code>,
          <code>beforeOptionsComponent</code>
          and
          <code>afterOptionsComponent</code>
          to replace the default chrome.
        </p>
      </:description>
      <:example>
        <BoxelMultiSelect
          @options={{this.items}}
          @selected={{this.selectedItems}}
          @onChange={{this.onSelectItems}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @renderInPlace={{this.renderInPlace}}
          @matchTriggerWidth={{this.matchTriggerWidth}}
          @searchEnabled={{this.searchEnabled}}
          @searchField='name'
          @closeOnSelect={{this.closeOnSelect}}
          @ariaLabel={{this.placeholder}}
          as |option|
        >
          {{option.name}}
        </BoxelMultiSelect>
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='options'
          @description='Items listed in the dropdown'
          @required={{true}}
          @items={{this.displayItems}}
        />
        <Args.Array
          @name='selected'
          @description='Currently selected items'
          @required={{true}}
        />
        <Args.Action
          @name='onChange'
          @description='Called with the new array of selected items'
          @required={{true}}
        />
        <Args.Yield
          @name='option'
          @description='Option to render in the dropdown'
        />
        <Args.String
          @name='placeholder'
          @description='Shown in the trigger when nothing is selected'
          @value={{this.placeholder}}
          @onInput={{fn (mut this.placeholder)}}
        />
        <Args.Bool
          @name='disabled'
          @description='Prevents interaction'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{fn (mut this.disabled)}}
        />
        <Args.Bool
          @name='renderInPlace'
          @description='Renders the dropdown next to the trigger instead of in the body'
          @defaultValue={{false}}
          @value={{this.renderInPlace}}
          @onInput={{fn (mut this.renderInPlace)}}
        />
        <Args.Bool
          @name='matchTriggerWidth'
          @description='Makes the dropdown as wide as the trigger'
          @defaultValue={{true}}
          @value={{this.matchTriggerWidth}}
          @onInput={{fn (mut this.matchTriggerWidth)}}
        />
        <Args.Bool
          @name='searchEnabled'
          @description='Shows a search box above the options'
          @defaultValue={{false}}
          @value={{this.searchEnabled}}
          @onInput={{fn (mut this.searchEnabled)}}
        />
        <Args.String
          @name='searchField'
          @description='Option property the search matches against'
        />
        <Args.Bool
          @name='closeOnSelect'
          @description='Closes the dropdown after each selection'
          @defaultValue={{true}}
          @value={{this.closeOnSelect}}
          @onInput={{fn (mut this.closeOnSelect)}}
        />
        <Args.String
          @name='ariaLabel'
          @description='Accessible name for the trigger'
          @value={{this.placeholder}}
        />
        <Args.String
          @name='eventType'
          @description="Trigger event that opens the dropdown: 'mousedown' or 'click'"
        />
        <Args.String
          @name='dropdownClass'
          @description='Extra class for the dropdown'
        />
        <Args.String
          @name='destination'
          @description='Id of the element the dropdown renders into'
        />
        <Args.Bool
          @name='initiallyOpened'
          @description='Opens the dropdown on first render'
          @defaultValue={{false}}
        />
        <Args.Action
          @name='onOpen'
          @description='Called when the dropdown opens'
        />
        <Args.Action
          @name='onClose'
          @description='Called when the dropdown closes'
        />
        <Args.Action
          @name='onBlur'
          @description='Called when the trigger loses focus'
        />
        <Args.Action
          @name='registerAPI'
          @description="Called with power-select's public API"
        />
        <Args.Object
          @name='extra'
          @description='Data passed through to the custom components'
        />
        <Args.Component
          @name='triggerComponent'
          @description='Replaces the trigger'
        />
        <Args.Component
          @name='selectedItemComponent'
          @description='Renders each selected item in the trigger'
        />
        <Args.Component
          @name='beforeOptionsComponent'
          @description="Rendered above the options; defaults to power-select's search box"
        />
        <Args.Component
          @name='afterOptionsComponent'
          @description='Rendered below the options'
        />
      </:api>
    </FreestyleUsage>

    <FreestyleUsage @name='Usage with FieldContainer'>
      <:example>
        <BoxelField @label='Country'>
          <BoxelMultiSelect
            @options={{this.items}}
            @selected={{this.selectedItems}}
            @onChange={{this.onSelectItems}}
            @placeholder='Select countries'
            @searchEnabled={{true}}
            @searchField='name'
            @closeOnSelect={{false}}
            @ariaLabel='Select countries'
            as |option|
          >
            {{option.name}}
          </BoxelMultiSelect>
        </BoxelField>
      </:example>
    </FreestyleUsage>
  </template>
}
