import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import type { PowerSelectArgs } from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';
import PowerSelectMultiple from 'ember-power-select/components/power-select-multiple';

import { BoxelAfterOptionsComponent } from './after-options.gts';
import BoxelSelectedItem, {
  type SelectedItemSignature,
} from './selected-item.gts';
import BoxelTrigger, { type TriggerComponentSignature } from './trigger.gts';

export interface BoxelMultiSelectArgs<ItemT> extends PowerSelectArgs {
  options: ItemT[];
  selected: ItemT[];
  selectedItemComponent?: ComponentLike<SelectedItemSignature<ItemT>>;
  triggerComponent?: ComponentLike<TriggerComponentSignature<ItemT>>;
}

export interface Signature<ItemT> {
  Args: BoxelMultiSelectArgs<ItemT>;
  Blocks: {
    default: [any];
  };
  Element: HTMLElement;
}

// CUSTOM EDIT YOUR MULTI-SELECT COMPONENT
// There are a few custom components that you can pass in
// 1. The selected item component
// 2. The trigger component
// 3. The dropdown component (which is generally called within the block in ember-power-select). We don't use the optionsComponent.
// 4. The afterOptions component
// 5. The beforeOptions component
// BoxelMultiSelectBasic gives you the flexibility to pass in these components
// BoxelMultiSelect has defaults of these components but allows you to optionally pass in your own selectedItemComponent that is used by our custom BoxelTrigger

export class BoxelMultiSelectBasic<ItemT> extends Component<Signature<ItemT>> {
  <template>
    <div class='boxel-multi-select__wrapper'>
      <PowerSelectMultiple
        {{! required args }}
        @options={{@options}}
        @selected={{@selected}}
        @onChange={{@onChange}}
        {{! basic options }}
        @placeholder={{@placeholder}}
        @disabled={{@disabled}}
        @renderInPlace={{@renderInPlace}}
        @matchTriggerWidth={{@matchTriggerWidth}}
        @searchField={{@searchField}}
        @searchEnabled={{@searchEnabled}}
        @closeOnSelect={{@closeOnSelect}}
        @eventType={{@eventType}}
        @ariaLabel={{@ariaLabel}}
        @dropdownClass={{'boxel-multi-select__dropdown'}}
        {{! actions  }}
        @onOpen={{@onOpen}}
        @onBlur={{@onBlur}}
        {{! custom components }}
        @selectedItemComponent={{@selectedItemComponent}}
        @triggerComponent={{@triggerComponent}}
        @afterOptionsComponent={{@afterOptionsComponent}}
        @beforeOptionsComponent={{@beforeOptionsComponent}}
        ...attributes
        as |option|
      >
        {{yield option}}
      </PowerSelectMultiple>
    </div>
    {{! template-lint-disable no-unscoped-styles }}
    <style>
      .boxel-multi-select__dropdown {
        box-shadow: var(--boxel-box-shadow);
        border-radius: var(--boxel-form-control-border-radius);
      }
      .boxel-multi-select__dropdown ul {
        list-style: none;
        padding: 0;
        overflow: auto;
        flex-grow: 1;
      }
      .boxel-multi-select__dropdown li {
        padding: var(--boxel-sp-5xs) var(--boxel-sp-4xs);
      }
      .boxel-multi-select__dropdown .ember-power-select-option {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
      }
      .boxel-multi-select__dropdown
        .ember-power-select-option[aria-selected='true'] {
        background: var(--boxel-100);
      }
      .boxel-multi-select__dropdown
        .ember-power-select-option[aria-current='true'] {
        color: black;
        background: var(--boxel-100);
      }
      .boxel-multi-select__dropdown .ember-power-select-search-input:focus {
        border: 1px solid var(--boxel-outline-color);
        box-shadow: var(--boxel-box-shadow-hover);
        outline: var(--boxel-outline);
      }
      .boxel-multi-select__dropdown
        .ember-power-select-option--no-matches-message {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-sm);
      }
    </style>
    <style scoped>
      .boxel-multi-select__wrapper {
        position: relative;
        display: flex;
        align-items: stretch;
        flex-grow: 1;
        overflow: hidden;
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius-sm);
      }
      .ember-basic-dropdown-trigger {
        padding: var(--boxel-sp-xxxs);
        display: flex;
        align-items: center;
        flex-grow: 1;
        border: none;
      }
      .ember-power-select-trigger:focus,
      .ember-power-select-trigger--active {
        border: none;
        box-shadow: none;
        outline: none;
      }
      .ember-power-select-trigger:after {
        margin-left: 10px;
      }
      .ember-power-select-multiple-options {
        list-style: none;
        gap: var(--boxel-sp-xxxs);
        width: auto;
      }
      .ember-power-select-multiple-option {
        padding: var(--boxel-sp-5xs);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-4xs);
        color: var(--boxel-multi-select-pill-color, var(--boxel-dark));
        background-color: var(
          --boxel-selected-pill-background-color,
          var(--boxel-200)
        );
        margin: 0;
      }
    </style>
  </template>
}

export default class BoxelMultiSelect<ItemT> extends Component<
  Signature<ItemT>
> {
  <template>
    <BoxelMultiSelectBasic
      {{! required args }}
      @options={{@options}}
      @selected={{@selected}}
      @onChange={{@onChange}}
      {{! basic options }}
      @placeholder={{@placeholder}}
      @disabled={{@disabled}}
      @renderInPlace={{@renderInPlace}}
      @matchTriggerWidth={{@matchTriggerWidth}}
      @searchField={{@searchField}}
      @searchEnabled={{@searchEnabled}}
      @closeOnSelect={{@closeOnSelect}}
      @ariaLabel={{@ariaLabel}}
      {{! Do not remove eventType argument 
    This is to ensure that the click event from selected item does not bubble up to the trigger
     and cause the dropdown to close
       do not remove eventType argument }}
      @eventType='click'
      {{! actions }}
      @onOpen={{@onOpen}}
      @onBlur={{@onBlur}}
      {{! custom components }}
      @selectedItemComponent={{if
        @selectedItemComponent
        @selectedItemComponent
        (component BoxelSelectedItem)
      }}
      @triggerComponent={{component BoxelTrigger}}
      @beforeOptionsComponent={{component BeforeOptions}}
      @afterOptionsComponent={{component BoxelAfterOptionsComponent}}
      ...attributes
      as |option|
    >
      {{yield option}}
    </BoxelMultiSelectBasic>
  </template>
}
