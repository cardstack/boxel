import Component from '@glimmer/component';
import { action } from '@ember/object';
import type {
  Select,
  PowerSelectArgs,
} from 'ember-power-select/components/power-select';
import PowerSelectMultiple from 'ember-power-select/components/power-select-multiple';
import { tracked } from '@glimmer/tracking';

import { on } from '@ember/modifier';
import cn from '../../helpers/cn.ts';
//import { IconX } from '@cardstack/boxel-ui/icons';
import { BoxelButton } from '@cardstack/boxel-ui/components';

export interface BoxelMultiSelectArgs<ItemT> extends PowerSelectArgs {
  options: ItemT[];
  selected: ItemT[];
}

interface Signature<ItemT = any> {
  Args: BoxelMultiSelectArgs<ItemT>;
  Blocks: {
    default: [ItemT];
  };
  Element: HTMLElement;
}

interface SelectAPI {
  isOpen: boolean;
  actions: {
    close: () => void;
    open: () => void;
  };
}

export default class BoxelMultiSelect extends Component<Signature> {
  @tracked selectAPI: SelectAPI | null = null;

  @action
  registerAPI(selectAPI: SelectAPI) {
    this.selectAPI = { ...selectAPI, isOpen: false };
    console.log('registerAPI', selectAPI);
  }

  @action
  onClearAll() {
    if (typeof this.args.onChange === 'function') {
      this.args.onChange([], {
        selected: [],
        searchText: '',
        actions: this.selectAPI?.actions || {},
      } as Select);
    }
  }

  @action
  toggleDropdown(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    if (this.selectAPI) {
      this.selectAPI.isOpen = !this.selectAPI.isOpen;

      if (!this.selectAPI.isOpen) {
        this.selectAPI.actions.open();
      } else {
        this.selectAPI.actions.close();
      }
    }
  }

  <template>
    <div class='boxel-multi-select__wrapper'>
      <PowerSelectMultiple
        @options={{@options}}
        @selected={{@selected}}
        @selectedItemComponent={{@selectedItemComponent}}
        @placeholder={{@placeholder}}
        @onChange={{@onChange}}
        @onBlur={{@onBlur}}
        @renderInPlace={{@renderInPlace}}
        @verticalPosition={{@verticalPosition}}
        @dropdownClass={{cn 'boxel-multi-select__dropdown' @dropdownClass}}
        @triggerComponent={{@triggerComponent}}
        @disabled={{@disabled}}
        @matchTriggerWidth={{@matchTriggerWidth}}
        @eventType='click'
        @searchEnabled={{@searchEnabled}}
        @searchField={{@searchField}}
        @registerAPI={{this.registerAPI}}
        as |option|
      >

        {{yield option}}
      </PowerSelectMultiple>
      <div class='boxel-multi-select__icons-wrapper'>
        <BoxelButton
          @as='button'
          @kind='primary'
          @size='small'
          {{on 'click' this.onClearAll}}
        >
          Clear All
        </BoxelButton>
      </div>
    </div>

    <style>
      .boxel-multi-select__wrapper {
        position: relative;
        display: flex;
        align-items: stretch;
        flex-grow: 1;
      }

      .boxel-multi-select {
        background: none;
        border: none;
        outline: none;
        padding: var(--boxel-sp-xxxs);
        cursor: pointer;
      }

      .ember-basic-dropdown-trigger {
        padding: var(--boxel-sp-xxxs);
        display: flex;
        flex-grow: 1;
        border: 1px solid var(--boxel-form-control-border-color);
        border-right: none;
        border-radius: var(--boxel-form-control-border-radius) 0 0
          var(--boxel-form-control-border-radius);
      }

      .ember-power-select-trigger:after {
        margin-left: 10px;
      }

      .boxel-multi-select__icons-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--boxel-form-control-border-color);
        border-left: none;
        border-radius: 0 var(--boxel-form-control-border-radius)
          var(--boxel-form-control-border-radius) 0;

        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxs);
        width: max-content;
      }

      .boxel-multi-select__clear-all,
      .boxel-multi-select__caret {
        --icon-color: var(--boxel-dark);
        position: relative;
        border: none;
        background: none;
        padding: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
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

      .boxel-multi-select__dropdown
        .ember-power-select-option[aria-selected='true'] {
        background: var(--boxel-200);
      }

      .boxel-multi-select__dropdown
        .ember-power-select-option[aria-current='true'] {
        color: black;
        background: var(--boxel-200);
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

      .ember-power-select-status-icon {
        display: block;
      }
    </style>
  </template>
}
