import Component from '@glimmer/component';
import PowerSelect, {
  type Select,
  type PowerSelectArgs,
} from 'ember-power-select/components/power-select';
import PowerSelectMultiple from 'ember-power-select/components/power-select-multiple';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';

import cn from '../../helpers/cn.ts';
import setScopedCss from '../../modifiers/set-scoped-css.ts';
import { action } from '@ember/object';

import { tracked } from '@glimmer/tracking';

export interface BoxelSelectArgs<ItemT> extends PowerSelectArgs {
  multipleSelection: boolean;
  options: ItemT[];
}

interface Signature<ItemT = any> {
  Args: BoxelSelectArgs<ItemT>;
  Blocks: {
    default: [ItemT];
  };
  Element: HTMLElement;
}

class BoxelSelect extends Component<Signature> {
  @tracked toggleScopedCss = false;

  @action
  onDropdownOpen(select: Select, e: Event): boolean {
    if (this.args.onOpen && this.args.onOpen(select, e) === false) {
      return false;
    }
    this.toggleScopedCss = true;
    return true;
  }

  @action
  onDropdownClose(select: Select, e: Event): boolean {
    if (this.args.onClose && this.args.onClose(select, e) === false) {
      return false;
    }
    this.toggleScopedCss = true;
    return true;
  }

  <template>
    {{#if @multipleSelection}}
      <PowerSelectMultiple
        class='boxel-select'
        @options={{@options}}
        @searchField={{@searchField}}
        @selected={{@selected}}
        @selectedItemComponent={{@selectedItemComponent}}
        @placeholder={{@placeholder}}
        @onChange={{@onChange}}
        @onOpen={{this.onDropdownOpen}}
        @onClose={{this.onDropdownClose}}
        @onBlur={{@onBlur}}
        @renderInPlace={{@renderInPlace}}
        @verticalPosition={{@verticalPosition}}
        @dropdownClass={{cn 'boxel-select__dropdown' @dropdownClass}}
        @triggerComponent={{@triggerComponent}}
        @disabled={{@disabled}}
        @matchTriggerWidth={{false}}
        @eventType='click'
        @searchEnabled={{@searchEnabled}}
        @beforeOptionsComponent={{component BeforeOptions autofocus=false}}
        {{setScopedCss this.toggleScopedCss}}
        ...attributes
        as |item|
      >
        {{item}}
      </PowerSelectMultiple>
    {{else}}
      <PowerSelect
        class='boxel-select'
        @options={{@options}}
        @searchField={{@searchField}}
        @selected={{@selected}}
        @selectedItemComponent={{@selectedItemComponent}}
        @placeholder={{@placeholder}}
        @onChange={{@onChange}}
        @onOpen={{this.onDropdownOpen}}
        @onClose={{this.onDropdownClose}}
        @onBlur={{@onBlur}}
        @renderInPlace={{@renderInPlace}}
        @verticalPosition={{@verticalPosition}}
        @dropdownClass={{cn 'boxel-select__dropdown' @dropdownClass}}
        @triggerComponent={{@triggerComponent}}
        @disabled={{@disabled}}
        @matchTriggerWidth={{false}}
        @eventType='click'
        @searchEnabled={{@searchEnabled}}
        @beforeOptionsComponent={{component BeforeOptions autofocus=false}}
        {{setScopedCss this.toggleScopedCss}}
        ...attributes
        as |item|
      >
        {{item}}
      </PowerSelect>
    {{/if}}
    <style>
      .boxel-select {
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        background: none;
        display: flex;
        gap: var(--boxel-sp-sm);
        padding-right: var(--boxel-sp);
      }
      .boxel-select :deep(.ember-power-select-status-icon) {
        position: relative;
      }
      .boxel-select:after {
        display: none;
      }
    </style>
    <style>
      #ember-basic-dropdown-wormhole .boxel-select__dropdown {
        --boxel-select-current-color: var(--boxel-select-current-color);
        --boxel-select-selected-color: var(--boxel-select-selected-color);
        --boxel-select-below-transitioning-in-animation: drop-fade-below
          var(--boxel-transition);
        --boxel-select-below-transitioning-out-animation: var(
            --boxel-select-below-transitioning-in-animation
          )
          reverse;
        --boxel-select-above-transitioning-in-animation: drop-fade-above
          var(--boxel-transition);
        --boxel-select-above-transitioning-out-animation: var(
            --boxel-select-above-transitioning-in-animation
          )
          reverse;
      }

      #ember-basic-dropdown-wormhole :deep(.boxel-select__dropdown) ul {
        color: var(--boxel-select-current-color);
        list-style: none;
        padding: 0;
        overflow: auto;
      }
      #ember-basic-dropdown-wormhole
        :deep(.ember-power-select-option[aria-selected='true']) {
        background-color: var(--boxel-select-selected-color);
      }

      #ember-basic-dropdown-wormhole
        :deep(.ember-power-select-option[aria-current='true']) {
        background-color: var(--boxel-select-selected-color);
      }

      .boxel-select__dropdown.ember-basic-dropdown-content--below.ember-basic-dropdown--transitioning-in {
        animation: var(--boxel-select-below-transitioning-in-animation);
      }

      .boxel-select__dropdown.ember-basic-dropdown-content--below.ember-basic-dropdown--transitioning-out {
        animation: var(--boxel-select-below-transitioning-out-animation);
      }

      .boxel-select__dropdown.ember-basic-dropdown-content--above.ember-basic-dropdown--transitioning-in {
        animation: var(--boxel-select-above-transitioning-in-animation);
      }

      .boxel-select__dropdown.ember-basic-dropdown-content--above.ember-basic-dropdown--transitioning-out {
        animation: var(--boxel-select-above-transitioning-out-animation);
      }

      @keyframes drop-fade-below {
        0% {
          opacity: 0;
          transform: translateY(-20px);
        }

        100% {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes drop-fade-above {
        0% {
          opacity: 0;
          transform: translateY(20px);
        }

        100% {
          opacity: 1;
          transform: translateY(0);
        }
      }
    </style>
  </template>
}

export default BoxelSelect;
