import { action } from '@ember/object';
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import type { Select } from 'ember-power-select/components/power-select';

import BoxelInput from '../input/index.gts';
import type { PickerOption } from './index.gts';

const autoFocus = modifier((element: HTMLElement) => {
  element.focus();
});

export interface BeforeOptionsWithSearchSignature {
  Args: {
    extra?: {
      filterOptions?: (
        options: PickerOption[],
        searchTerm: string,
      ) => PickerOption[];
      onSearchTermChange?: (term: string) => void;
      searchPlaceholder?: string;
      searchTerm?: string;
    };
    select: Select;
  };
}

export default class PickerBeforeOptionsWithSearch extends Component<BeforeOptionsWithSearchSignature> {
  get searchTerm() {
    return this.args.extra?.searchTerm || '';
  }

  get searchPlaceholder() {
    return this.args.extra?.searchPlaceholder || 'search for a realm';
  }

  @action
  updateSearchTerm(value: string) {
    this.args.extra?.onSearchTermChange?.(value);
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
    </div>

    <style scoped>
      .picker-before-options {
        background-color: var(--boxel-light);
        padding: 0 var(--boxel-sp-2xs);
      }

      .picker-before-options__search {
        --boxel-input-search-color: var(--boxel-dark);
        --boxel-input-search-background-color: transparent;
        --icon-full-length: var(--boxel-icon-xs);
        padding: 0 var(--boxel-sp-2xs);
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

      .picker-before-options__search-input:focus-visible {
        outline: none;
      }
    </style>
  </template>
}
