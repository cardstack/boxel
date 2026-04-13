import { autoFocus } from '@cardstack/boxel-ui/modifiers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { Select } from 'ember-power-select/components/power-select';

import BoxelInput from '../input/index.gts';
import type { PickerOption } from './index.gts';
import PickerOptionRow from './option-row.gts';

export interface BeforeOptionsWithSearchSignature {
  Args: {
    extra?: {
      filterOptions?: (
        options: PickerOption[],
        searchTerm: string,
      ) => PickerOption[];
      isSelectAllActive?: boolean;
      onSearchTermChange?: (term: string) => void;
      onToggleItem?: (item: PickerOption) => void;
      searchPlaceholder?: string;
      searchTerm?: string;
      selectAllOption?: PickerOption;
      selectedItems?: PickerOption[];
    };
    select: Select;
  };
}

export default class PickerBeforeOptionsWithSearch extends Component<BeforeOptionsWithSearchSignature> {
  get searchTerm() {
    return this.args.extra?.searchTerm || '';
  }

  get searchPlaceholder() {
    return this.args.extra?.searchPlaceholder || 'Search...';
  }

  get selectAllOption() {
    return this.args.extra?.selectAllOption;
  }

  get isSelectAllActive() {
    return this.args.extra?.isSelectAllActive ?? false;
  }

  get selectedItems() {
    return this.args.extra?.selectedItems ?? [];
  }

  @action
  updateSearchTerm(value: string) {
    this.args.extra?.onSearchTermChange?.(value);
  }

  @action
  handleToggleItem(item: PickerOption, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.args.extra?.onToggleItem?.(item);
  }

  <template>
    <div class='picker-before-options' data-test-boxel-picker-before-options>
      <div class='picker-before-options__search' data-test-boxel-picker-search>
        <BoxelInput
          @type='search'
          @value={{this.searchTerm}}
          @onInput={{this.updateSearchTerm}}
          @placeholder={{this.searchPlaceholder}}
          class='picker-before-options__search-input'
          {{autoFocus}}
        />
      </div>

      <div
        class='picker-before-options__selected-summary'
        data-test-boxel-picker-selected-summary
      >
        {{#if this.selectAllOption}}
          <button
            type='button'
            class='picker-before-options__option'
            data-test-boxel-picker-select-all
            {{on 'click' (fn this.handleToggleItem this.selectAllOption)}}
          >
            <PickerOptionRow
              @option={{this.selectAllOption}}
              @isSelected={{this.isSelectAllActive}}
            />
          </button>
        {{/if}}
        {{#each this.selectedItems as |item|}}
          <button
            type='button'
            class='picker-before-options__option'
            data-test-boxel-picker-summary-item={{item.id}}
            {{on 'click' (fn this.handleToggleItem item)}}
          >
            <PickerOptionRow @option={{item}} @isSelected={{true}} />
          </button>
        {{/each}}
      </div>

      <div class='picker-divider' data-test-boxel-picker-divider></div>
    </div>

    <style scoped>
      .picker-before-options {
        background-color: var(--boxel-light);
      }

      .picker-before-options__search {
        --boxel-input-search-color: var(--boxel-dark);
        --boxel-input-search-background-color: transparent;
        --icon-full-length: var(--boxel-icon-xs);
        padding: 0 calc(2 * var(--boxel-sp-2xs));
      }

      .picker-before-options__search :deep(.input-container) {
        --icon-full-length: var(--boxel-icon-xs);
      }

      .picker-before-options__search :deep(.search-icon) {
        color: var(--boxel-dark);
        height: 14px;
        width: 14px;
      }

      .picker-before-options__search :deep(.search) {
        padding-left: calc(var(--boxel-icon-xs) + var(--boxel-sp-2xs));
      }

      .picker-before-options__search-input {
        width: 100%;
        border: none;
      }

      .picker-before-options__search-input:focus-visible,
      .search {
        outline: none;
      }

      .picker-before-options__option {
        all: unset;
        display: block;
        width: 100%;
        cursor: pointer;
        box-sizing: border-box;
        border-radius: 4px;
      }

      .picker-before-options__option:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: -2px;
      }

      .picker-before-options__selected-summary {
        max-height: 150px;
        overflow-y: auto;
        padding: 0 var(--boxel-sp-2xs) var(--boxel-sp-2xs) var(--boxel-sp-2xs);
      }

      .picker-divider {
        height: 1px;
        background-color: var(--boxel-200);
        width: 100%;
      }
    </style>
  </template>
}
