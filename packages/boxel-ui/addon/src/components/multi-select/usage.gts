import { array, fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import BoxelMultiSelect from './index.gts';
import { includes } from 'lodash';

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
  @tracked placeholder = 'Select Items';
  @tracked verticalPosition = 'auto' as const;

  @tracked renderInPlace = false;
  @tracked disabled = false;
  @tracked searchField = '';
  @tracked searchEnabled = false;
  @tracked matchTriggerWidth = true;

  @cssVariable({ cssClassName: 'boxel-multi-select__dropdown' })
  declare boxelMultiSelectCurrentColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'boxel-multi-select__dropdown' })
  declare boxelMultiSelectSelectedColor: CSSVariableInfo;

  @action onSelectItems(items: Country[]): void {
    this.selectedItems = items;
  }

  @tracked assignees = [
    { name: 'No assignee', issues: 28, avatar: '🚫' },
    { name: 'Current user', issues: 1, avatar: '👤' },
    { name: 'tintinthong', issues: 1, avatar: '🧑' },
    { name: 'lucas.law', issues: 1, avatar: '🧑' },
    { name: 'lukemelia', issues: 2, avatar: '🧑' },
    { name: 'matic', issues: 2, avatar: '👨' },
  ] as Array<AssigneeOption>;

  @tracked selectedAssignees: AssigneeOption[] = [];

  @action onSelectAssignees(assignees: AssigneeOption[]) {
    this.selectedAssignees = assignees;
  }

  <template>
    <style
    >
      .boxel-multi-select-usage {
        --boxel-select-current-color: {{this.boxelMultiSelectCurrentColor.value}};
        --boxel-select-selected-color: {{this.boxelMultiSelectSelectedColor.value}};
      }
    </style>
    <FreestyleUsage @name='Multi Select'>
      <:example>
        <BoxelMultiSelect
          @placeholder={{this.placeholder}}
          @searchEnabled={{this.searchEnabled}}
          @searchField={{this.searchField}}
          @selected={{this.selectedItems}}
          @onChange={{this.onSelectItems}}
          @options={{this.items}}
          @verticalPosition={{this.verticalPosition}}
          @renderInPlace={{this.renderInPlace}}
          @disabled={{this.disabled}}
          @dropdownClass='boxel-multi-select-usage'
          @matchTriggerWidth={{this.matchTriggerWidth}}
          @selectedItemComponent={{component CustomPill}}
          aria-label={{this.placeholder}}
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelMultiSelect>
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='options'
          @description='An array of items, to be listed on dropdown'
          @required={{true}}
          @items={{this.items}}
          @onChange={{this.onSelectItems}}
        />
        <Args.Action
          @name='onChange'
          @description='Invoke this action to handle selected items'
          @required={{true}}
        />
        <Args.Array
          @name='selected'
          @description='Array of selected items'
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
          @name='boxel-select-current-color'
          @type='color'
          @defaultValue={{this.boxelMultiSelectCurrentColor.defaults}}
          @value={{this.boxelMultiSelectCurrentColor.value}}
          @onInput={{this.boxelMultiSelectCurrentColor.update}}
        />
        <Css.Basic
          @name='boxel-select-selected-color'
          @type='color'
          @defaultValue={{this.boxelMultiSelectSelectedColor.defaults}}
          @value={{this.boxelMultiSelectSelectedColor.value}}
          @onInput={{this.boxelMultiSelectSelectedColor.update}}
        />
      </:cssVars>
    </FreestyleUsage>

    <FreestyleUsage @name='Assignee Multi Select'>
      <:example>
        <BoxelMultiSelect
          @placeholder='Select assignees'
          @searchEnabled={{true}}
          @searchField='name'
          @selected={{this.selectedAssignees}}
          @onChange={{this.onSelectAssignees}}
          @options={{this.assignees}}
          @renderInPlace={{true}}
          @matchTriggerWidth={{true}}
          @selectedItemComponent={{component AssigneePill isInDropdown=false}}
          aria-label='Select assignees'
          as |assignee|
        >
          <AssigneePill
            @option={{assignee}}
            @isSelected={{includes this.selectedAssignees assignee}}
            @isInDropdown={{true}}
          />
        </BoxelMultiSelect>
      </:example>
    </FreestyleUsage>
  </template>
}

interface CustomPillArgs {
  Element: Element;
  Args: {
    option: Country;
  };
}

class CustomPill extends Component<CustomPillArgs> {
  <template>
    <span class='custom-pill'>
      {{@option.name}}
    </span>
    <style>
      .custom-pill {
        background-color: #e0e0e0;
        border-radius: 16px;
        padding: 4px 8px;
        margin-right: 4px;
        display: inline-flex;
        align-items: center;
      }
      .custom-pill button {
        background: none;
        border: none;
        cursor: pointer;
        margin-left: 4px;
        font-weight: bold;
      }
    </style>
  </template>
}

interface AssigneeOption {
  avatar: string;
  name: string;
  issues: number;
}

interface AssigneePillArgs {
  Element: Element;
  Args: {
    option: AssigneeOption;
    isSelected: boolean;
    isInDropdown?: boolean;
  };
}

class AssigneePill extends Component<AssigneePillArgs> {
  get issueText() {
    const { issues } = this.args.option;
    return `${issues} ${issues === 1 ? 'issue' : 'issues'}`;
  }

  <template>
    <span class='assignee-pill {{if @isInDropdown "dropdown-item"}}'>
      {{#if @isInDropdown}}
        <input type='checkbox' checked={{@isSelected}} />
      {{/if}}
      <span class='assignee-avatar'>{{@option.avatar}}</span>
      <span class='assignee-name'>{{@option.name}}</span>
      {{#if @isInDropdown}}
        <span class='assignee-issues'>{{this.issueText}}</span>
      {{/if}}
    </span>

    <style>
      .assignee-pill {
        display: flex;
        align-items: center;
        font-size: var(--boxel-font-size-sm);
      }
      .dropdown-item {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
      }
      .assignee-avatar {
        width: var(--boxel-sp-lg);
        height: var(--boxel-sp-lg);
        border-radius: 50%;
        background-color: var(--avatar-bg-color, #e0e0e0);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
      }
      .assignee-name {
        flex-grow: 1;
      }
      .assignee-issues {
        color: var(--boxel-orange);
        font-size: var(--boxel-font-size-xs);
      }
      input[type='checkbox'] {
        margin-right: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
