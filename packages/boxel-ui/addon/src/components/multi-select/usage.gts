import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';
import type { Select } from 'ember-power-select/components/power-select';
import { includes } from 'lodash';
import pluralize from 'pluralize';

import cn from '../../helpers/cn.ts';
import cssVar from '../../helpers/css-var.ts';
import CheckMark from '../../icons/check-mark.gts';
import BoxelMultiSelect, { BoxelMultiSelectBasic } from './index.gts';
import BoxelSelectedItem from './selected-item.gts';

export function getPlural(s: string, count?: number) {
  return pluralize(s, count);
}

interface Country {
  name: string;
}

interface AssigneeOption {
  avatar: string;
  issues: number;
  name: string;
}

interface CheckBoxArgs {
  Args: {
    isSelected: boolean;
    option: AssigneeOption;
  };
  Element: Element;
}

class CheckboxIndicator extends Component<CheckBoxArgs> {
  <template>
    <div class='checkbox-indicator'>
      <span class={{cn 'check-icon' check-icon--selected=@isSelected}}>
        <CheckMark width='12' height='12' />
      </span>
    </div>
    <style scoped>
      .checkbox-indicator {
        width: 16px;
        height: 16px;
        border: 1px solid var(--boxel-500);
        border-radius: 3px;
        margin-right: var(--boxel-sp-xs);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .checkbox-indicator:hover,
      .checkbox-indicator:focus {
        box-shadow: 0 0 0 2px var(--boxel-dark-teal);
      }
      .check-icon {
        --icon-color: var(--boxel-dark-teal);
        visibility: collapse;
        display: contents;
      }
      .check-icon--selected {
        visibility: visible;
      }
    </style>
  </template>
}

interface AssigneePillArgs {
  Args: {
    isSelected: boolean;
    option: AssigneeOption;
  };
  Element: Element;
}

//Custom component for rendering dropdown items with enhanced design and functionality
class AssigneePill extends Component<AssigneePillArgs> {
  <template>
    <span class='assignee-pill'>
      <div class='assignee-pill-content'>
        <CheckboxIndicator @isSelected={{@isSelected}} @option={{@option}} />
        <div class='assignee-avatar'>{{@option.avatar}}</div>
        <div class='assignee-name'>{{@option.name}}</div>
      </div>
      <div class='assignee-issues'>{{@option.issues}}
        {{getPlural 'issue' @option.issues}}</div>
    </span>

    <style scoped>
      .assignee-pill {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: var(--boxel-font-size-sm);
        cursor: pointer;
        width: 100%;
      }
      .assignee-pill.selected {
        background-color: var(--boxel-highlight);
      }
      .assignee-pill-content {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
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
        color: var(--boxel-dark-teal);
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>
}

export class SelectedCountry extends BoxelSelectedItem<Country> {
  <template>
    <div class='selected-country'>
      <CheckMark width='12' height='12' />
      {{@option.name}}
    </div>
  </template>
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
  @tracked matchTriggerWidth = true;

  @tracked selectedAssignees: AssigneeOption[] = [];
  @tracked hasCheckbox = false;
  @tracked useCustomTriggerComponent = false;

  @tracked selectedFilter: string | undefined = undefined;
  @tracked publicAPI: Select | undefined = undefined;

  @cssVariable({ cssClassName: 'boxel-multi-select-usage-container' })
  declare boxelSelectedPillBackgroundColor: CSSVariableInfo;

  @cssVariable({ cssClassName: 'boxel-multi-select-usage-container' })
  declare boxelMultiSelectPillColor: CSSVariableInfo;

  @tracked assignees = [
    { name: 'No assignee', issues: 28, avatar: '🚫' },
    { name: 'Current user', issues: 1, avatar: '👤' },
    { name: 'tintinthong', issues: 1, avatar: '🧑' },
    { name: 'lucas.law', issues: 1, avatar: '🧑' },
    { name: 'lukemelia', issues: 2, avatar: '🧑' },
    { name: 'matic', issues: 2, avatar: '👨' },
  ] as Array<AssigneeOption>;

  @action onSelectItems(items: Country[]): void {
    this.selectedItems = items;
  }

  @action onSelectAssignees(assignees: AssigneeOption[]) {
    this.selectedAssignees = assignees;
  }

  @action updateFilter(o: string | undefined): void {
    this.selectedFilter = o;
    this.openDropdown();
  }

  //We need this to open the dropdown from outside the component
  @action registerAPI(select: Select): void {
    this.publicAPI = select; //note: we must link select by reference
  }

  @action openDropdown(): void {
    this.publicAPI?.actions.open();
  }

  @action onClose(): boolean | undefined {
    this.selectedFilter = undefined;
    return true;
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
        <:description>
          <p>
            Boxel Multi Select is a component that enables the selection of
            multiple items from a customizable dropdown list. It is a wrapper
            around the PowerSelectMultiple component from the ember-power-select
            library, offering off-the-shelf functionality and design.
          </p>
          <p>Key features include:</p>
          <ol>
            <li>Customizable search functionality</li>
            <li>Styled trigger with a summary of selected items</li>
            <li>Custom rendering of selected items</li>
            <li>Option to keep the dropdown open after selection</li>
            <li>"X more items" pill for compact display of numerous selections</li>
            <li>Function to Clear All selected items</li>
          </ol>
          <p>This component works out-of-the-box with BoxelDropdown and Select
            components within this design library</p>
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
            @searchField='name'
            @searchEnabled={{true}}
            @closeOnSelect={{false}}
            @ariaLabel='Select countries'
            as |option|
          >
            {{option.name}}
          </BoxelMultiSelect>

        </:example>
        <:api as |Args|>
          {{! TODO: This is a bug. Args.Array does not display the objects in the UI in ember-freestyle }}
          <Args.Object
            @name='options'
            @description='An array of objects, to be listed on dropdown'
            @value={{this.items}}
            @onInput={{fn (mut this.items)}}
          />
          <Args.Array
            @name='selected'
            @description='Array of selected items'
            @required={{true}}
          />
          <Args.String
            @name='placeholder'
            @description='Placeholder for trigger component'
            @value={{this.placeholder}}
            @onInput={{fn (mut this.placeholder)}}
          />
          <Args.Bool
            @name='disabled'
            @defaultValue={{false}}
            @value={{this.disabled}}
            @onInput={{fn (mut this.disabled)}}
            @description='When truthy the component cannot be interacted'
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

      <FreestyleUsage @name='Custom Dropdown Component'>
        <:example>
          <BoxelMultiSelect
            @options={{this.assignees}}
            @selected={{this.selectedAssignees}}
            @onChange={{this.onSelectAssignees}}
            @placeholder='Select assignees'
            @renderInPlace={{this.renderInPlace}}
            @matchTriggerWidth={{true}}
            @searchField='name'
            @searchEnabled={{true}}
            @closeOnSelect={{false}}
            @ariaLabel='Select assignees'
            as |option|
          >
            <AssigneePill
              @option={{option}}
              @isSelected={{includes this.selectedAssignees option}}
            />
          </BoxelMultiSelect>
        </:example>
      </FreestyleUsage>

      <FreestyleUsage
        @name='Custom Selected Item Component (Uses our TriggerComponent)'
      >
        <:example>
          <BoxelMultiSelect
            @options={{this.assignees}}
            @selected={{this.selectedAssignees}}
            @onChange={{this.onSelectAssignees}}
            @placeholder='Select assignees'
            @renderInPlace={{this.renderInPlace}}
            @matchTriggerWidth={{true}}
            @searchField='name'
            @searchEnabled={{true}}
            @closeOnSelect={{false}}
            @ariaLabel='Select countries'
            @selectedItemComponent={{(component SelectedCountry)}}
            as |option|
          >
            {{option.name}}
          </BoxelMultiSelect>
        </:example>
      </FreestyleUsage>

      <FreestyleUsage @name='Boxel Multi Select Basic'>
        <:example>
          <BoxelMultiSelectBasic
            @options={{this.assignees}}
            @selected={{this.selectedAssignees}}
            @placeholder='Select assignees'
            @renderInPlace={{this.renderInPlace}}
            @matchTriggerWidth={{true}}
            @searchField='name'
            @searchEnabled={{true}}
            @closeOnSelect={{false}}
            @onChange={{this.onSelectAssignees}}
            @ariaLabel='Select assignees'
            as |option|
          >
            {{option.name}}
          </BoxelMultiSelectBasic>
        </:example>
        <:description>
          <p>
            Boxel Multi Select Basic is a basic implementation of our Multi
            Select component. It is a simpler version of Boxel Multi Select that
            does not include custom components for the selected items, trigger,
            beforeOptions, and afterOptions. If you would like to maintain, the
            default style of ember-power-select but build your own components,
            you should use this.
          </p>
        </:description>
      </FreestyleUsage>
    </div>
  </template>
}
