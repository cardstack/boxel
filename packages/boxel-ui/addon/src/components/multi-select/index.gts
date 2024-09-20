import Component from '@glimmer/component';
import { action } from '@ember/object';
import { type PowerSelectArgs } from 'ember-power-select/components/power-select';
import BeforeOptions from 'ember-power-select/components/power-select/before-options';
import PowerSelectMultiple from 'ember-power-select/components/power-select-multiple';
import { on } from '@ember/modifier';
import cn from '../../helpers/cn.ts';
import { tracked } from '@glimmer/tracking';
import { IconX, CaretDown } from '@cardstack/boxel-ui/icons';
import { IconButton } from '@cardstack/boxel-ui/components';

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

export default class BoxelMultiSelect extends Component<Signature> {
  @tracked selectAPI: any;

  @action
  registerAPI(selectAPI: any) {
    this.selectAPI = selectAPI;
  }

  @action
  onClearAll() {
    if (typeof this.args.onChange === 'function') {
      this.args.onChange([]);
    }
  }

  @action
  toggleDropdown(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    console.log('Toggle dropdown called');
    if (this.selectAPI) {
      console.log('Current isOpen state:', this.selectAPI.isOpen);
      if (this.selectAPI.isOpen) {
        console.log('Attempting to close');
        this.selectAPI.actions.close();
      } else {
        console.log('Attempting to open');
        this.selectAPI.actions.open();
      }
    } else {
      console.log('selectAPI is not set');
    }
  }

  <template>
    <div class='boxel-multi-select__wrapper'>
      <PowerSelectMultiple
        class='boxel-multi-select'
        @options={{@options}}
        @searchField={{@searchField}}
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
        @beforeOptionsComponent={{component BeforeOptions}}
        @registerAPI={{this.registerAPI}}
        ...attributes
        as |option|
      >
        {{yield option}}
      </PowerSelectMultiple>
      <div class='boxel-multi-select__icons-wrapper'>
        {{#if @selected.length}}
          <IconButton
            @icon={{IconX}}
            @width='12'
            @height='12'
            {{on 'click' this.onClearAll}}
            class='boxel-multi-select__clear-all'
            aria-label='clear all selections'
          />
        {{/if}}

        <IconButton
          @icon={{CaretDown}}
          @width='13'
          @height='13'
          {{on 'click' this.toggleDropdown}}
          class='boxel-multi-select__caret'
          aria-label='toggle dropdown'
        />
      </div>
    </div>

    <style scoped>
      :global(.boxel-multi-select__wrapper) {
        position: relative;
      }

      :global(.boxel-multi-select) {
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        background: none;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-xxxs);
        cursor: pointer;
        flex-grow: 1;
      }

      :global(.boxel-multi-select__icons-wrapper) {
        position: absolute;
        right: var(--boxel-sp-xxs);
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: end;
        gap: var(--boxel-sp-xxs);
        width: max-content;
      }

      .boxel-multi-select__clear-all,
      .boxel-multi-select__caret {
        --icon-color: var(--boxel-dark);
        position: relative;
        width: 20px;
        height: 20px;
        border: none;
        background: none;
        padding: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .boxel-multi-select__caret::before {
        content: '';
        position: absolute;
        left: calc(-1 * var(--boxel-sp-xxs) - 0.5px);
        top: 50%;
        transform: translateY(-50%);
        height: 20px;
        width: 1px;
        background-color: var(--boxel-border-color, #ccc);
      }

      .boxel-multi-select__clear-all:hover,
      .boxel-multi-select__caret:hover {
        --icon-color: var(--boxel-highlight);
      }

      .boxel-multi-select__clear-all {
        margin-right: var(--boxel-sp-xxs);
      }

      .boxel-multi-select__caret {
        transition: transform 0.2s ease;
      }

      .boxel-multi-select__caret[aria-expanded='true'] {
        transform: rotate(180deg);
      }

      :global(.boxel-multi-select:after) {
        display: none;
      }
      :global(.boxel-multi-select ul) {
        list-style: none;
        gap: var(--boxel-sp-xxxs);
        width: auto;
      }
      :global(.boxel-multi-select li.ember-power-select-multiple-option) {
        padding: var(--boxel-sp-5xs);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        color: var(--boxel-multi-select-pill-color, var(--boxel-dark));
        background-color: var(
          --boxel-selected-pill-background-color,
          var(--boxel-200)
        );
      }

      :global(.boxel-multi-select__dropdown) {
        box-shadow: var(--boxel-box-shadow);
        border-radius: var(--boxel-form-control-border-radius);
      }
      :global(.boxel-multi-select__dropdown ul) {
        list-style: none;
        padding: 0;
        overflow: auto;
      }
      :global(.boxel-multi-select__dropdown li) {
        padding: var(--boxel-sp-5xs) var(--boxel-sp-4xs);
      }

      :global(
          .boxel-multi-select__dropdown
            .ember-power-select-option[aria-selected='true']
        ) {
        background: var(--boxel-200);
      }

      :global(
          .boxel-multi-select__dropdown
            .ember-power-select-option[aria-current='true']
        ) {
        color: black;
        background: var(--boxel-200);
      }

      :global(
          .boxel-multi-select__dropdown .ember-power-select-search-input:focus
        ) {
        border: 1px solid var(--boxel-outline-color);
        box-shadow: var(--boxel-box-shadow-hover);
        outline: var(--boxel-outline);
      }

      :global(
          .boxel-multi-select__dropdown
            .ember-power-select-option--no-matches-message
        ) {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-sm);
      }

      :global(.ember-power-select-status-icon) {
        display: none;
      }
    </style>
  </template>
}
