import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { Select } from 'ember-power-select/components/power-select';
import { includes } from 'lodash';

import type { Icon } from '../../icons/types.ts';
import { BoxelMultiSelectBasic } from '../multi-select/index.gts';
import PickerBeforeOptionsWithSearch from './before-options-with-search.gts';
import PickerOptionRow from './option-row.gts';
import PickerLabeledTrigger from './trigger-labeled.gts';

export type PickerOption = {
  icon?: Icon | string;
  id: string;
  name: string;
  type?: 'select-all' | 'option';
};

export interface PickerSignature {
  Args: {
    // State
    disabled?: boolean;
    // Display
    label: string;
    matchTriggerWidth?: boolean;

    onChange: (selected: PickerOption[]) => void;
    // Data
    options: PickerOption[];

    placeholder?: string;

    renderInPlace?: boolean;
    searchPlaceholder?: string;
    selected: PickerOption[];
  };
  Blocks: {
    default: [PickerOption, Select];
  };
  Element: HTMLElement;
}

export default class Picker extends Component<PickerSignature> {
  @tracked searchTerm = '';

  // When there is a search term:
  // - Always keep any "select-all" (search-all) option at the very top
  // - Then list already-selected options (so they stay visible even if they don't match the term)
  // - Then list unselected options that match the search term, in their original order
  get filteredOptions(): PickerOption[] {
    if (!this.searchTerm) {
      return this.args.options;
    }

    const selectAll = this.args.options.filter((o) => o.type === 'select-all');
    const selectedOptions = this.args.options.filter(
      (o) => this.args.selected.includes(o) && o.type !== 'select-all',
    );
    const unselectedOptions = this.args.options.filter(
      (o) => !this.args.selected.includes(o) && o.type !== 'select-all',
    );

    const term = this.searchTerm.toLowerCase();
    return [
      ...selectAll,
      ...selectedOptions,
      ...unselectedOptions.filter((option) => {
        const text = option.name.toLowerCase();
        return text.includes(term);
      }),
    ];
  }

  // Reorders the already-filtered options so that:
  // - "select-all" (search-all) options are always first
  // - Selected regular options come next
  // - Unselected regular options are listed last
  get sortedOptions(): PickerOption[] {
    const options = this.filteredOptions;
    const selected = options.filter(
      (o) => this.args.selected.includes(o) && o.type !== 'select-all',
    );
    const unselected = options.filter(
      (o) => !this.args.selected.includes(o) && o.type !== 'select-all',
    );
    const selectAll = options.filter((o) => o.type === 'select-all');
    return [...selectAll, ...selected, ...unselected];
  }

  get selectedInSortedOptions(): PickerOption[] {
    return this.sortedOptions.filter((o) => this.args.selected.includes(o));
  }

  get isSelected() {
    return (option: PickerOption) => includes(this.args.selected, option);
  }

  isLastSelected = (option: PickerOption) => {
    const selectedInSorted = this.selectedInSortedOptions;
    const lastSelected = selectedInSorted[selectedInSorted.length - 1];
    return lastSelected === option;
  };

  get hasUnselected() {
    const unselected = this.sortedOptions.filter(
      (o) => !this.args.selected.includes(o),
    );
    return unselected.length > 0;
  }

  get triggerComponent() {
    return PickerLabeledTrigger;
  }

  onSearchTermChange = (term: string) => {
    this.searchTerm = term;
  };

  get extra() {
    return {
      label: this.args.label,
      searchTerm: this.searchTerm,
      searchPlaceholder: this.args.searchPlaceholder,
      onSearchTermChange: this.onSearchTermChange,
    };
  }

  displayDivider = (option: PickerOption) => {
    return (
      (this.isLastSelected(option) && this.hasUnselected) ||
      (option.type === 'select-all' &&
        this.selectedInSortedOptions.length === 0)
    );
  };

  <template>
    <BoxelMultiSelectBasic
      @options={{this.sortedOptions}}
      @selected={{@selected}}
      @onChange={{@onChange}}
      @placeholder={{@placeholder}}
      @disabled={{@disabled}}
      @renderInPlace={{@renderInPlace}}
      @matchTriggerWidth={{@matchTriggerWidth}}
      @searchEnabled={{false}}
      @closeOnSelect={{false}}
      @eventType='click'
      @extra={{this.extra}}
      @triggerComponent={{component this.triggerComponent}}
      @beforeOptionsComponent={{component PickerBeforeOptionsWithSearch}}
      @dropdownClass='boxel-picker__dropdown'
      ...attributes
      as |option|
    >
      <PickerOptionRow
        @option={{option}}
        @isSelected={{this.isSelected option}}
        @currentSelected={{@selected}}
      />
      {{#if (this.displayDivider option)}}
        <div class='picker-divider' data-test-boxel-picker-divider></div>
      {{/if}}
    </BoxelMultiSelectBasic>

    <style scoped>
      .picker-divider {
        height: 1px;
        background-color: var(--boxel-200);
        margin: var(--boxel-sp-2xs) 0;
      }

      .boxel-picker__dropdown .ember-power-select-option {
        padding: 0 var(--boxel-sp-2xs);
      }
      .boxel-picker__dropdown .ember-power-select-option[aria-current='true'],
      .boxel-picker__dropdown .ember-power-select-option[aria-selected='true'] {
        background-color: transparent;
        color: var(--boxel-dark);
      }
    </style>
  </template>
}
