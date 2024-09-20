import { array, fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';
import { includes } from 'lodash';

import cssVar from '../../helpers/css-var.ts';
import BoxelMultiSelect from './index.gts';

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

  @cssVariable({ cssClassName: 'boxel-multi-select-usage-container' })
  declare boxelSelectedPillBackgroundColor: CSSVariableInfo;

  @cssVariable({ cssClassName: 'boxel-multi-select-usage-container' })
  declare boxelMultiSelectPillColor: CSSVariableInfo;

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
    <div
      class='boxel-multi-select-usage-container'
      style={{cssVar
        boxel-selected-pill-background-color=this.boxelSelectedPillBackgroundColor.value
        boxel-multi-select-pill-color=this.boxelMultiSelectPillColor.value
      }}
    >
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
            as |item|
          >
            <CustomPill @option={{item}} />
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
            @name='boxel-selected-pill-background-color'
            @type='background-color'
            @defaultValue={{this.boxelSelectedPillBackgroundColor.defaults}}
            @value={{this.boxelSelectedPillBackgroundColor.value}}
            @onInput={{this.boxelSelectedPillBackgroundColor.update}}
          />
          <Css.Basic
            @name='boxel-multi-select-pill-color'
            @type='color'
            @defaultValue={{this.boxelMultiSelectPillColor.defaults}}
            @value={{this.boxelMultiSelectPillColor.value}}
            @onInput={{this.boxelMultiSelectPillColor.update}}
          />
        </:cssVars>
      </FreestyleUsage>

      <FreestyleUsage @name='Assignee Multi Select'>
        <:example>

          <BoxelMultiSelect
            aria-labelledby='assignee-multi-select-label'
            @placeholder='Select assignees'
            @searchEnabled={{true}}
            @searchField='name'
            @selected={{this.selectedAssignees}}
            @onChange={{this.onSelectAssignees}}
            @options={{this.assignees}}
            @renderInPlace={{true}}
            @matchTriggerWidth={{true}}
            @selectedItemComponent={{component AssigneePill isInDropdown=false}}
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
    </div>
  </template>
}

interface CustomPillArgs {
  Args: {
    option: Country;
  };
  Element: Element;
}

class CustomPill extends Component<CustomPillArgs> {
  <template>
    <span class='custom-pill'>
      {{@option.name}}
    </span>
    <style scoped>
      .custom-pill {
        display: inline-flex;
        align-items: center;
      }
    </style>
  </template>
}

interface AssigneeOption {
  avatar: string;
  issues: number;
  name: string;
}

interface AssigneePillArgs {
  Args: {
    isInDropdown?: boolean;
    isSelected: boolean;
    option: AssigneeOption;
  };
  Element: Element;
}

class AssigneePill extends Component<AssigneePillArgs> {
  get issueText() {
    const { issues } = this.args.option;
    return `${issues} ${issues === 1 ? 'issue' : 'issues'}`;
  }

  <template>
    <span class='assignee-pill {{if @isInDropdown "dropdown-item"}}'>
      {{#if @isInDropdown}}
        <label class='checkbox-label'>
          <input
            type='checkbox'
            checked={{@isSelected}}
            aria-label='Select {{@option.name}}'
          />
          <span class='visually-hidden'>Select {{@option.name}}</span>
        </label>
      {{/if}}
      <span class='assignee-avatar'>{{@option.avatar}}</span>
      <span class='assignee-name'>{{@option.name}}</span>
      {{#if @isInDropdown}}
        <span class='assignee-issues'>{{this.issueText}}</span>
      {{/if}}
    </span>

    <style scoped>
      .assignee-pill {
        display: flex;
        align-items: center;
        font-size: var(--boxel-font-size-sm);
      }
      .dropdown-item {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
      }
      .assignee-avatar {
        width: var(--boxel-sp-sm);
        height: var(--boxel-sp-sm);
        border-radius: 50%;
        background-color: var(--avatar-bg-color, var(--boxel-light));
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
      .checkbox-label {
        display: flex;
        align-items: center;
        margin-right: var(--boxel-sp-xs);
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    </style>
  </template>
}
