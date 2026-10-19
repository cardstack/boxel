import Component from '@glimmer/component';
import type { PowerSelectArgs } from 'ember-power-select/components/power-select';
import PowerSelect from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';
import type { Option, Select } from 'ember-power-select/types';

import { cn, not } from '../../helpers.gts';

// Everything else is inherited from ember-power-select's own args;
// options/selected are re-declared only to make them required.
export interface BoxelMultiSelectArgs<ItemT> extends PowerSelectArgs<
  ItemT,
  true
> {
  options: NonNullable<PowerSelectArgs<ItemT, true>['options']>;
  selected: NonNullable<PowerSelectArgs<ItemT, true>['selected']>;
}

export interface Signature<ItemT> {
  Args: BoxelMultiSelectArgs<ItemT>;
  Blocks: {
    default: [Option<ItemT>, Select<ItemT, true>];
  };
  Element: HTMLElement;
}

// Options render through the default block. Callers may pass their own
// selectedItem, trigger, beforeOptions and afterOptions components; only
// beforeOptions has a default (power-select's own BeforeOptions).

export class BoxelMultiSelect<ItemT> extends Component<Signature<ItemT>> {
  <template>
    <PowerSelect
      class={{cn
        'boxel-multi-select'
        boxel-multi-select--rounded=(not @matchTriggerWidth)
      }}
      @multiple={{true}}
      {{! required args }}
      @options={{@options}}
      @selected={{@selected}}
      @onChange={{@onChange}}
      {{! basic options }}
      @placeholder={{@placeholder}}
      @disabled={{@disabled}}
      @renderInPlace={{@renderInPlace}}
      @destination={{@destination}}
      @matchTriggerWidth={{@matchTriggerWidth}}
      @searchField={{@searchField}}
      @searchEnabled={{@searchEnabled}}
      @closeOnSelect={{@closeOnSelect}}
      @eventType={{@eventType}}
      @ariaLabel={{@ariaLabel}}
      @registerAPI={{@registerAPI}}
      @initiallyOpened={{@initiallyOpened}}
      @extra={{@extra}}
      @dropdownClass={{cn
        @dropdownClass
        'boxel-multi-select__dropdown'
        boxel-multi-select__dropdown--rounded=(not @matchTriggerWidth)
      }}
      {{! actions  }}
      @onOpen={{@onOpen}}
      @onClose={{@onClose}}
      @onBlur={{@onBlur}}
      {{! custom components }}
      @selectedItemComponent={{@selectedItemComponent}}
      @triggerComponent={{@triggerComponent}}
      @afterOptionsComponent={{@afterOptionsComponent}}
      @beforeOptionsComponent={{if
        @beforeOptionsComponent
        @beforeOptionsComponent
        BeforeOptions
      }}
      ...attributes
      as |option select|
    >
      {{yield option select}}
    </PowerSelect>
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
      .boxel-multi-select__dropdown--rounded.ember-power-select-dropdown {
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--boxel-border-radius-sm);
      }
    </style>
    <style scoped>
      .boxel-multi-select {
        position: relative;
        display: flex;
        align-items: stretch;
        overflow: hidden;
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--boxel-border-radius-sm);
        max-width: 100%;
        width: 100%;
      }
      .ember-power-select-multiple-options {
        list-style: none;
        gap: var(--boxel-sp-xxxs);
        width: auto;
      }
      .ember-power-select-trigger {
        padding: 0;
      }
      .boxel-multi-select--rounded.ember-power-select-trigger[aria-expanded='true'] {
        border-radius: var(--boxel-border-radius-sm);
      }
    </style>
  </template>
}

/** @deprecated Use BoxelMultiSelect instead */
export const BoxelMultiSelectBasic = BoxelMultiSelect;
