import type Owner from '@ember/owner';
import { scheduleOnce } from '@ember/runloop';
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
    maxSelectedDisplay?: number;

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
  @tracked private pinnedOption: PickerOption | null = null;
  @tracked private pinnedToSection: 'selected' | 'unselected' | null = null;

  constructor(owner: Owner, args: PickerSignature['Args']) {
    super(owner, args);
    this.validateSelectAllOption();
    scheduleOnce('afterRender', this, this.ensureDefaultSelection);
  }

  get renderInPlace() {
    return this.args.renderInPlace ?? true;
  }

  private validateSelectAllOption() {
    const hasSelectAll = this.args.options.some(
      (option) => option.type === 'select-all',
    );
    if (!hasSelectAll) {
      throw new Error(
        'Picker requires a select-all option in @options (type: "select-all").',
      );
    }
  }

  private ensureDefaultSelection() {
    if (this.args.selected.length === 0) {
      const selectAllOptions = this.args.options.filter(
        (option) => option.type === 'select-all',
      );
      if (selectAllOptions.length > 0) {
        this.args.onChange(selectAllOptions);
      }
    }
  }

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
  // - Selected regular options come next (including pinned items that were in selected section)
  // - Unselected regular options are listed last (including pinned items that were in unselected section)
  get sortedOptions(): PickerOption[] {
    const options = this.filteredOptions;
    const { pinnedOption, pinnedToSection } = this;

    const selected = options.filter((o) => {
      if (o.type === 'select-all') return false;
      // If this is the pinned option, check which section it should stay in
      if (o === pinnedOption) {
        return pinnedToSection === 'selected';
      }
      return this.args.selected.includes(o);
    });

    const unselected = options.filter((o) => {
      if (o.type === 'select-all') return false;
      // If this is the pinned option, check which section it should stay in
      if (o === pinnedOption) {
        return pinnedToSection === 'unselected';
      }
      return !this.args.selected.includes(o);
    });

    const selectAll = options.filter((o) => o.type === 'select-all');
    return [...selectAll, ...selected, ...unselected];
  }

  private isVisuallyInSelectedSection(option: PickerOption): boolean {
    if (option.type === 'select-all') return false;
    if (option === this.pinnedOption) {
      return this.pinnedToSection === 'selected';
    }
    return this.args.selected.includes(option);
  }

  get selectedInSortedOptions(): PickerOption[] {
    return this.sortedOptions.filter((o) =>
      this.isVisuallyInSelectedSection(o),
    );
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
      (o) => o.type !== 'select-all' && !this.isVisuallyInSelectedSection(o),
    );
    return unselected.length > 0;
  }

  get triggerComponent() {
    return PickerLabeledTrigger;
  }

  onSearchTermChange = (term: string) => {
    this.searchTerm = term;
  };

  onOptionHover = (option: PickerOption | null) => {
    if (option && option.type !== 'select-all') {
      // Remember where the option was when hover started
      this.pinnedOption = option;
      this.pinnedToSection = this.args.selected.includes(option)
        ? 'selected'
        : 'unselected';
    } else {
      this.pinnedOption = null;
      this.pinnedToSection = null;
    }
  };

  get extra() {
    return {
      label: this.args.label,
      searchTerm: this.searchTerm,
      searchPlaceholder: this.args.searchPlaceholder,
      onSearchTermChange: this.onSearchTermChange,
      maxSelectedDisplay: this.args.maxSelectedDisplay,
    };
  }

  onChange = (selected: PickerOption[]) => {
    const selectAllOptions = selected.filter((option) => {
      return option.type === 'select-all';
    });
    const nonSelectAllOptions = selected.filter((option) => {
      return option.type !== 'select-all';
    });
    const previouslyHadSelectAll = this.args.selected.some(
      (option) => option.type === 'select-all',
    );
    const allSelectAllOptions = this.args.options.filter(
      (option) => option.type === 'select-all',
    );
    const allNonSelectAllOptions = this.args.options.filter(
      (option) => option.type !== 'select-all',
    );

    // Deselect select-all if there are other options selected
    if (selectAllOptions.length > 0 && nonSelectAllOptions.length > 0) {
      if (previouslyHadSelectAll) {
        this.args.onChange(nonSelectAllOptions);
        return;
      }
      this.args.onChange(selectAllOptions);
      return;
    }

    // Select select-all if all other options are selected
    // and deselect all other options
    // or if no options are selected
    let isAllOptionsSelected =
      nonSelectAllOptions.length > 0 &&
      nonSelectAllOptions.length === allNonSelectAllOptions.length;
    let isNoOptionSelected = nonSelectAllOptions.length === 0;
    if (
      allSelectAllOptions.length > 0 &&
      (isAllOptionsSelected || isNoOptionSelected)
    ) {
      this.args.onChange(allSelectAllOptions);
      return;
    }
    this.args.onChange(selected);
  };

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
      @onChange={{this.onChange}}
      @placeholder={{@placeholder}}
      @disabled={{@disabled}}
      @renderInPlace={{this.renderInPlace}}
      @matchTriggerWidth={{@matchTriggerWidth}}
      @searchEnabled={{false}}
      @closeOnSelect={{false}}
      @eventType='click'
      @ariaLabel={{@label}}
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
        @onHover={{this.onOptionHover}}
      />
      {{#if (this.displayDivider option)}}
        <div class='picker-divider' data-test-boxel-picker-divider></div>
      {{/if}}
    </BoxelMultiSelectBasic>

    {{! template-lint-disable require-scoped-style }}
    <style>
      .picker-divider {
        height: 1px;
        background-color: var(--boxel-200);
        margin: var(--boxel-sp-2xs) 0;
        width: 100%;
      }

      .boxel-picker__dropdown .ember-power-select-option {
        padding: 0 var(--boxel-sp-2xs);
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .boxel-picker__dropdown .ember-power-select-option[aria-current='true'],
      .boxel-picker__dropdown .ember-power-select-option[aria-selected='true'] {
        background-color: transparent;
        color: var(--boxel-dark);
      }

      .fitted-template :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute;
      }
    </style>
  </template>
}
