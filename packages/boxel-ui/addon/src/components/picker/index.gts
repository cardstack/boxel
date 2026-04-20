import type Owner from '@ember/owner';
import { scheduleOnce } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ComponentLike } from '@glint/template';
import { modifier } from 'ember-modifier';
import type { Select } from 'ember-power-select/components/power-select';

import type { Icon } from '../../icons/types.ts';
import LoadingIndicator from '../loading-indicator/index.gts';
import { BoxelMultiSelectBasic } from '../multi-select/index.gts';
import PickerBeforeOptionsWithSearch from './before-options-with-search.gts';
import PickerOptionRow from './option-row.gts';
import PickerLabeledTrigger from './trigger-labeled.gts';

export type PickerOption = {
  disabled?: boolean;
  icon?: Icon | string;
  id: string;
  label: string;
  shortLabel?: string;
  tooltip?: string;
  type?: 'select-all' | 'option';
};

export interface PickerSignature {
  Args: {
    afterOptionsComponent?: ComponentLike<any>;
    destination?: string;
    disableClientSideSearch?: boolean;
    disabled?: boolean;
    extra?: Record<string, unknown>;
    hasMore?: boolean;
    isLoading?: boolean;
    isLoadingMore?: boolean;
    label: string;
    matchTriggerWidth?: boolean;
    maxSelectedDisplay?: number;
    onChange: (selected: PickerOption[]) => void;
    onLoadMore?: () => void;
    onSearchTermChange?: (term: string) => void;
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

let loadMoreSentinel = modifier(
  (
    element: Element,
    [onLoadMore, isLoadingMore]: [
      (() => void) | undefined,
      boolean | undefined,
    ],
    { enabled }: { enabled?: boolean },
  ) => {
    if (!enabled || !onLoadMore) {
      return;
    }

    let optionsList = element
      .closest('.ember-basic-dropdown-content')
      ?.querySelector('.ember-power-select-options') as HTMLElement | null;
    if (!optionsList) {
      return;
    }

    let alreadyRequested = false;
    let handleScroll = () => {
      if (isLoadingMore || alreadyRequested) {
        return;
      }
      let { scrollTop, scrollHeight, clientHeight } = optionsList;
      if (scrollTop + clientHeight >= scrollHeight - 50) {
        alreadyRequested = true;
        onLoadMore();
      }
    };

    optionsList.addEventListener('scroll', handleScroll);

    // Check immediately: if the list is short enough to fit without
    // scrolling, we're already at the "bottom" and should load more.
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- scroll measurement needs post-paint layout
    requestAnimationFrame(() => handleScroll());

    return () => optionsList!.removeEventListener('scroll', handleScroll);
  },
);

interface PickerAfterOptionsSignature {
  Args: {
    extra?: Record<string, any>;
    select: Record<string, any>;
  };
}

class PickerLoadingOverlay extends Component<PickerAfterOptionsSignature> {
  get isLoading(): boolean {
    return !!this.args.extra?.['isLoading'];
  }

  <template>
    {{#if this.isLoading}}
      <div class='picker-full-loading-overlay' data-test-picker-loading>
        <LoadingIndicator class='picker-full-loading-spinner' />
      </div>
    {{/if}}

    {{! template-lint-disable require-scoped-style }}
    <style>
      .picker-full-loading-overlay {
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--boxel-light);
      }
      .picker-full-loading-spinner {
        width: 24px;
        height: 24px;
      }
    </style>
  </template>
}

export default class Picker extends Component<PickerSignature> {
  @tracked searchTerm = '';

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

  // Returns non-select-all options in original order, filtered by search term.
  // Select-all is rendered in the before-options section, not in the main list.
  get displayOptions(): PickerOption[] {
    const nonSelectAll = this.args.options.filter(
      (o) => o.type !== 'select-all',
    );
    if (!this.searchTerm || this.args.disableClientSideSearch) {
      return nonSelectAll;
    }
    const term = this.searchTerm.toLowerCase();
    return nonSelectAll.filter((option) => {
      return option.label.toLowerCase().includes(term);
    });
  }

  get selectAllOption(): PickerOption | undefined {
    return this.args.options.find((o) => o.type === 'select-all');
  }

  get selectedItems(): PickerOption[] {
    return this.args.selected.filter((o) => o.type !== 'select-all');
  }

  get isSelectAllActive(): boolean {
    return this.args.selected.some((o) => o.type === 'select-all');
  }

  get isSelected() {
    return (option: PickerOption) => {
      return this.args.selected.some((o) => o.id === option.id);
    };
  }

  isLastOption = (option: PickerOption): boolean => {
    const display = this.displayOptions;
    return display.length > 0 && display[display.length - 1] === option;
  };

  get triggerComponent() {
    return PickerLabeledTrigger;
  }

  onSearchTermChange = (term: string) => {
    this.searchTerm = term;
    this.args.onSearchTermChange?.(term);
  };

  onClose = () => {
    if (this.searchTerm !== '') {
      this.searchTerm = '';
      this.args.onSearchTermChange?.('');
    }
    return true;
  };

  get extra() {
    return {
      ...this.args.extra,
      label: this.args.label,
      searchTerm: this.searchTerm,
      searchPlaceholder: this.args.searchPlaceholder,
      onSearchTermChange: this.onSearchTermChange,
      maxSelectedDisplay: this.args.maxSelectedDisplay,
      isLoading: this.args.isLoading,
      selectAllOption: this.selectAllOption,
      selectedItems: this.selectedItems,
      isSelectAllActive: this.isSelectAllActive,
    };
  }

  get dropdownClass(): string {
    let cls = 'boxel-picker__dropdown';
    if (this.args.isLoading) {
      cls += ' boxel-picker__dropdown--loading';
    }
    return cls;
  }

  get afterOptionsComponent(): ComponentLike<any> | undefined {
    if (this.args.afterOptionsComponent) {
      return this.args.afterOptionsComponent;
    }
    if (this.args.isLoading) {
      return PickerLoadingOverlay;
    }
    return undefined;
  }

  onToggleItem = (item: PickerOption) => {
    const isCurrentlySelected = this.args.selected.some(
      (o) => o.id === item.id,
    );
    let newSelected: PickerOption[];
    if (isCurrentlySelected) {
      newSelected = this.args.selected.filter((o) => o.id !== item.id);
    } else {
      newSelected = [...this.args.selected, item];
    }
    this.onChange(newSelected);
  };

  onChange = (selected: PickerOption[]) => {
    // Ignore clicks on disabled options
    const lastAdded = selected.find(
      (opt) => !this.args.selected.some((o) => o.id === opt.id),
    );
    if (lastAdded?.disabled) {
      return;
    }

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

  <template>
    <BoxelMultiSelectBasic
      @options={{this.displayOptions}}
      @selected={{@selected}}
      @onChange={{this.onChange}}
      @onClose={{this.onClose}}
      @placeholder={{@placeholder}}
      @disabled={{@disabled}}
      @renderInPlace={{this.renderInPlace}}
      @destination={{@destination}}
      @matchTriggerWidth={{@matchTriggerWidth}}
      @searchEnabled={{true}}
      @closeOnSelect={{false}}
      @eventType='click'
      @ariaLabel={{@label}}
      @extra={{this.extra}}
      @triggerComponent={{component this.triggerComponent}}
      @beforeOptionsComponent={{component PickerBeforeOptionsWithSearch}}
      @afterOptionsComponent={{this.afterOptionsComponent}}
      @dropdownClass={{this.dropdownClass}}
      ...attributes
      as |option|
    >
      <PickerOptionRow
        @option={{option}}
        @isSelected={{this.isSelected option}}
        @currentSelected={{@selected}}
      />
      {{#if (this.isLastOption option)}}
        {{#if @hasMore}}
          <div
            class='picker-load-more-sentinel'
            {{loadMoreSentinel @onLoadMore @isLoadingMore enabled=@hasMore}}
            data-test-picker-infinite-scroll
          >
            {{#if @isLoadingMore}}
              <div class='picker-bottom-loading' data-test-picker-loading-more>
                <LoadingIndicator class='picker-loading-spinner' />
              </div>
            {{/if}}
          </div>
        {{/if}}
      {{/if}}
    </BoxelMultiSelectBasic>

    {{! template-lint-disable require-scoped-style }}
    <style>
      .boxel-picker__dropdown {
        padding-bottom: var(--boxel-sp-3xs);
      }

      .boxel-picker__dropdown--loading .picker-before-options {
        position: relative;
        z-index: 2;
      }

      .boxel-picker__dropdown--loading
        .ember-power-select-option:not(:first-child) {
        display: none;
      }

      .boxel-picker__dropdown .ember-power-select-options {
        padding-top: var(--boxel-sp-2xs);
        outline: none;
        background:
          /* Shadow cover TOP — moves with content */
          linear-gradient(var(--boxel-light) 30%, rgba(255, 255, 255, 0)) center
            top / 100% 40px no-repeat local,
          /* Shadow TOP — fixed at top */
          radial-gradient(
              farthest-side at 50% 0,
              rgba(0, 0, 0, 0.12),
              rgba(0, 0, 0, 0)
            )
            center top / 100% 20px no-repeat scroll;
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

      .picker-load-more-sentinel {
        min-height: 1px;
      }
      .picker-bottom-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--boxel-sp-xxs) 0;
      }
      .picker-loading-spinner {
        width: 20px;
        height: 20px;
      }
    </style>
  </template>
}
