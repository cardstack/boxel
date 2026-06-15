import { autoFocus } from '@cardstack/boxel-ui/modifiers';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { scheduleOnce } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { Select } from 'ember-power-select/components/power-select';

import { eq } from '../../helpers.ts';
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
      searchEnabled?: boolean;
      searchPlaceholder?: string;
      searchTerm?: string;
      selectAllOption?: PickerOption;
      selectedItems?: PickerOption[];
    };
    select: Select;
  };
}

export default class PickerBeforeOptionsWithSearch extends Component<BeforeOptionsWithSearchSignature> {
  @tracked summaryHighlightId: string | null = null;
  @tracked private hasNavigated = false;

  constructor(owner: any, args: BeforeOptionsWithSearchSignature['Args']) {
    super(owner, args);
    // Highlight the first navigable item on open (select-all, first summary, or first main)
    scheduleOnce('afterRender', this, this.activateFirstItem);
  }

  private activateFirstItem() {
    const allItems = this.navigableItems;
    for (let i = 0; i < allItems.length; i++) {
      if (!allItems[i]?.disabled) {
        this.hasNavigated = true;
        this.activateAtIndex(i);
        return;
      }
    }
  }

  get searchTerm() {
    return this.args.extra?.searchTerm || '';
  }

  get searchPlaceholder() {
    return this.args.extra?.searchPlaceholder || 'Search...';
  }

  get showSearch() {
    return this.args.extra?.searchEnabled ?? true;
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

  get summaryItems(): PickerOption[] {
    const items: PickerOption[] = [];
    if (this.selectAllOption) {
      items.push(this.selectAllOption);
    }
    items.push(...this.selectedItems);
    return items;
  }

  get mainListItems(): PickerOption[] {
    return (this.args.select.results as PickerOption[]) ?? [];
  }

  get navigableItems(): PickerOption[] {
    return [...this.summaryItems, ...this.mainListItems];
  }

  private activateAtIndex(index: number) {
    const allItems = this.navigableItems;
    const option = allItems[index];
    if (!option) {
      return;
    }
    const summaryCount = this.summaryItems.length;

    if (index < summaryCount) {
      // Summary item
      this.summaryHighlightId = option.id;
      this.args.select.actions.highlight(undefined as any);
      this.scrollSummaryItemIntoView(option.id);
    } else {
      // Main list item — use the actual object from mainListItems
      this.summaryHighlightId = null;
      const mainOption = this.mainListItems[index - summaryCount];
      if (mainOption) {
        this.args.select.actions.highlight(mainOption);
        this.args.select.actions.scrollTo(mainOption);
      }
    }
  }

  private scrollSummaryItemIntoView(id: string) {
    const el = document.querySelector(
      `[data-boxel-picker-summary-item="${id}"]`,
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  private getCurrentIndex(): number {
    if (!this.hasNavigated) {
      return -1;
    }
    const summaryCount = this.summaryItems.length;

    if (this.summaryHighlightId) {
      // Find in summary section by id
      return this.summaryItems.findIndex(
        (i) => i.id === this.summaryHighlightId,
      );
    }
    // Find in main list section by reference equality, then offset
    const highlighted = this.args.select.highlighted as PickerOption;
    if (highlighted) {
      const mainIdx = this.mainListItems.indexOf(highlighted);
      return mainIdx >= 0 ? summaryCount + mainIdx : -1;
    }
    return -1;
  }

  private advanceHighlight(step: 1 | -1) {
    const allItems = this.navigableItems;
    if (allItems.length === 0) {
      return;
    }

    const currentIndex = this.getCurrentIndex();
    this.hasNavigated = true;

    let nextIndex = currentIndex;
    for (let i = 0; i < allItems.length; i++) {
      nextIndex += step;
      if (nextIndex < 0 || nextIndex >= allItems.length) {
        return;
      }
      const candidate = allItems[nextIndex];
      if (candidate && !candidate.disabled) {
        this.activateAtIndex(nextIndex);
        return;
      }
    }
  }

  @action
  updateSearchTerm(value: string) {
    this.summaryHighlightId = null;
    this.hasNavigated = false;
    this.args.extra?.onSearchTermChange?.(value);
  }

  @action
  handleKeydown(event: Event) {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    const select = this.args.select;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.advanceHighlight(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.advanceHighlight(-1);
        break;
      case 'Enter': {
        event.preventDefault();
        const currentIdx = this.getCurrentIndex();
        if (this.summaryHighlightId) {
          const item = this.navigableItems.find(
            (i) => i.id === this.summaryHighlightId,
          );
          if (item) {
            select.actions.choose(item);
          }
        } else if (select.highlighted) {
          select.actions.choose(select.highlighted);
        }
        // Re-activate after choose to prevent EPS from resetting highlight
        if (currentIdx >= 0) {
          // Since the selected item is added/removed to/from the selected summary
          // so the index to activate after choose should be adjusted accordingly
          let indextoActivate = select.selected
            ? currentIdx + 1
            : currentIdx - 1;
          scheduleOnce(
            'afterRender',
            this,
            this.activateAtIndex,
            indextoActivate,
          );
        }
        break;
      }
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        select.actions.close(event);
        break;
    }
  }

  <template>
    {{! Keydown lives on the wrapper so navigation works even when the
        search input is hidden — events bubble from the input or the
        focus-target div. }}
    <div
      class='picker-before-options'
      data-test-boxel-picker-before-options
      tabindex='-1'
      {{on 'keydown' this.handleKeydown}}
    >
      {{#if this.showSearch}}
        <div
          class='picker-before-options__search'
          data-test-boxel-picker-search
        >
          <BoxelInput
            @type='search'
            @value={{this.searchTerm}}
            @onInput={{this.updateSearchTerm}}
            @placeholder={{this.searchPlaceholder}}
            @autocomplete='off'
            class='picker-before-options__search-input'
            {{autoFocus}}
          />
        </div>
      {{else}}
        <div
          class='picker-before-options__focus-target'
          tabindex='-1'
          data-test-boxel-picker-focus-target
          {{autoFocus}}
        ></div>
      {{/if}}

      <div
        class='picker-before-options__selected-summary'
        data-test-boxel-picker-selected-summary
      >
        {{#if this.selectAllOption}}
          <PickerOptionRow
            @option={{this.selectAllOption}}
            @isSelected={{this.isSelectAllActive}}
            @isHighlighted={{eq
              this.summaryHighlightId
              this.selectAllOption.id
            }}
            @select={{@select}}
            class='picker-before-options__option'
            data-test-boxel-picker-select-all
          />
        {{/if}}
        {{#each this.selectedItems as |item|}}
          <PickerOptionRow
            @option={{item}}
            @isSelected={{true}}
            @isHighlighted={{eq this.summaryHighlightId item.id}}
            @select={{@select}}
            class='picker-before-options__option'
            data-boxel-picker-summary-item={{item.id}}
            data-test-boxel-picker-summary-item={{item.id}}
          />
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

      .picker-before-options__focus-target {
        width: 0;
        height: 0;
        overflow: hidden;
        outline: none;
      }

      .picker-before-options:focus-visible {
        outline: none;
      }

      .picker-before-options__option {
        width: 100%;
        box-sizing: border-box;
      }

      .picker-before-options__selected-summary {
        max-height: 150px;
        overflow-y: auto;
        padding: 0 var(--boxel-sp-2xs) var(--boxel-sp-2xs) var(--boxel-sp-2xs);
        background:
          /* Shadow cover BOTTOM — moves with content */
          linear-gradient(rgba(255, 255, 255, 0), var(--boxel-light) 70%) center
            bottom / 100% 40px no-repeat local,
          /* Shadow BOTTOM — fixed at bottom */
          radial-gradient(
              farthest-side at 50% 100%,
              rgba(0, 0, 0, 0.12),
              rgba(0, 0, 0, 0)
            )
            center bottom / 100% 20px no-repeat scroll;
      }

      .picker-divider {
        height: 1px;
        background-color: var(--boxel-200);
        width: 100%;
      }
    </style>
  </template>
}
