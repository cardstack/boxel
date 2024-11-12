import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import type {
  PowerSelectArgs,
  Select,
} from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';
import PowerSelectMultiple from 'ember-power-select/components/power-select-multiple';
import { MatcherFn } from 'ember-power-select/utils/group-utils';

import { BoxelAfterOptionsComponent } from './after-options.gts';
import BoxelSelectedItem, {
  type SelectedItemSignature,
} from './selected-item.gts';
import BoxelMultiSelectDefaultTrigger, {
  type TriggerComponentSignature,
} from './trigger.gts';

export interface BoxelMultiSelectArgs<ItemT> extends PowerSelectArgs {
  ariaLabel?: string;
  closeOnSelect?: boolean;
  disabled?: boolean;
  extra?: any;
  matchTriggerWidth?: boolean;
  matcher?: MatcherFn;
  onBlur?: (select: Select, e: Event) => boolean | undefined;
  onClose?: (select: Select, e: Event) => boolean | undefined;
  onOpen?: (select: Select, e: Event) => boolean | undefined;
  options: ItemT[];
  placeholder?: string;
  renderInPlace?: boolean;
  searchEnabled?: boolean;
  searchField?: string;
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
    <PowerSelectMultiple
      class='boxel-multi-select'
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
      @registerAPI={{@registerAPI}}
      @initiallyOpened={{@initiallyOpened}}
      @extra={{@extra}}
      @dropdownClass={{'boxel-multi-select__dropdown'}}
      @matcher={{@matcher}}
      {{! actions  }}
      @onOpen={{@onOpen}}
      @onClose={{@onClose}}
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
    {{! template-lint-disable require-scoped-style }}
    <style>
      .boxel-multi-select__dropdown {
        box-shadow: var(--boxel-box-shadow);
        border-radius: var(--boxel-form-control-border-radius);
        z-index: var(
          --boxel-layer-modal-urgent
        ); /* TODO: Investigate why this is needed */
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
      .boxel-multi-select {
        position: relative;
        display: flex;
        align-items: stretch;
        flex-grow: 1;
        overflow: hidden;
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius-sm);
      }
      .ember-power-select-multiple-options {
        list-style: none;
        gap: var(--boxel-sp-xxxs);
        width: auto;
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
      @registerAPI={{@registerAPI}}
      @initiallyOpened={{@initiallyOpened}}
      @extra={{@extra}}
      @matcher={{@matcher}}
      {{! Do not remove eventType argument 
    This is to ensure that the click event from selected item does not bubble up to the trigger
     and cause the dropdown to close
       do not remove eventType argument }}
      @eventType='click'
      {{! actions }}
      @onOpen={{@onOpen}}
      @onClose={{@onClose}}
      @onBlur={{@onBlur}}
      {{! custom components }}
      @selectedItemComponent={{if
        @selectedItemComponent
        @selectedItemComponent
        (component BoxelSelectedItem)
      }}
      @triggerComponent={{component BoxelMultiSelectDefaultTrigger}}
      @beforeOptionsComponent={{component BeforeOptions}}
      @afterOptionsComponent={{component BoxelAfterOptionsComponent}}
      ...attributes
      as |option select|
    >
      {{yield option select}}
    </BoxelMultiSelectBasic>
  </template>
}
