import { IconTrash } from '@cardstack/boxel-ui/icons';
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
import BoxelMultiSelect, {
  type SelectedItemSignature,
  SelectedItem,
} from './index.gts';

interface Country {
  name: string;
}

interface AssigneeOption {
  avatar: string;
  issues: number;
  name: string;
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
  get issueText() {
    const { issues } = this.args.option;
    return `${issues} ${issues === 1 ? 'issue' : 'issues'}`;
  }

  <template>
    <span class='assignee-pill' role='option' aria-selected={{@isSelected}}>
      <div class='assignee-pill-content'>
        <div class='assignee-avatar'>{{@option.avatar}}</div>
        <div class='assignee-name'>{{@option.name}}</div>
      </div>
      <div class='assignee-issues'>{{this.issueText}}</div>
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

class SelectedCountry extends Component<SelectedItemSignature<Country>> {
  <template>
    <SelectedItem
      @item={{@item}}
      @removeItem={{@removeItem}}
      @useCustomTriggerComponent={{true}}
    >
      <:content>
        {{@item.name}}
      </:content>
      <:icon>
        <IconTrash />
      </:icon>
    </SelectedItem>
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
  @tracked useCustomTriggerComponent = true;

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
          <label id='country-select-label' class='visually-hidden'>Select
            countries</label>

          <BoxelMultiSelect
            @placeholder={{this.placeholder}}
            @selected={{this.selectedItems}}
            @customSelectedItem={{component SelectedCountry}}
            @useCustomTriggerComponent={{this.useCustomTriggerComponent}}
            @onChange={{this.onSelectItems}}
            @options={{this.items}}
            @verticalPosition={{this.verticalPosition}}
            @renderInPlace={{this.renderInPlace}}
            @disabled={{this.disabled}}
            @dropdownClass='boxel-multi-select-usage'
            @matchTriggerWidth={{this.matchTriggerWidth}}
            @hasCheckbox={{true}}
            @labelledBy='country-select-label'
            as |option|
          >
            {{option.name}}
          </BoxelMultiSelect>

        </:example>
        <:api as |Args|>
          <Args.Object
            @name='options'
            @description='An array of objects, to be listed on dropdown'
            @value={{this.items}}
            @onInput={{fn (mut this.items)}}
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
            @name='hasCheckbox'
            @defaultValue={{false}}
            @value={{this.hasCheckbox}}
            @onInput={{fn (mut this.hasCheckbox)}}
            @description='When true, displays a checkbox for each option'
          />
          <Args.Bool
            @name='useCustomTriggerComponent'
            @defaultValue={{false}}
            @value={{this.useCustomTriggerComponent}}
            @onInput={{fn (mut this.useCustomTriggerComponent)}}
            @description='When true, enables the use of a custom trigger component for selected items'
          />

          <Args.Object
            @name='customSelectedItem'
            @description='A custom component to render selected items when useCustomTriggerComponent is true. This component can customize the visual appearance and icon of the selected item.'
            @required={{this.useCustomTriggerComponent}}
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
          <label id='assignee-select-label' class='visually-hidden'>Select
            assignees</label>
          <BoxelMultiSelect
            @placeholder='Select assignees'
            @selected={{this.selectedAssignees}}
            @onChange={{this.onSelectAssignees}}
            @options={{this.assignees}}
            @renderInPlace={{this.renderInPlace}}
            @matchTriggerWidth={{true}}
            @hasCheckbox={{true}}
            @useCustomTriggerComponent={{this.useCustomTriggerComponent}}
            @labelledBy='assignee-select-label'
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

    </div>
    <style scoped>
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
      }
    </style>
  </template>
}
