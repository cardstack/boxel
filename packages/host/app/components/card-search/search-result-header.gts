import Component from '@glimmer/component';

import DeselectIcon from '@cardstack/boxel-icons/deselect';
import SelectAllIcon from '@cardstack/boxel-icons/select-all';

import {
  BoxelDropdown,
  Menu,
  SortDropdown,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import SelectionCheckmarkIcon from '@cardstack/host/components/adorn/selection-checkmark-icon';
import type { NewCardArgs } from '@cardstack/host/utils/card-search/types';

import type { SortOption } from './constants';
import type { ViewOption } from './constants';

interface Signature {
  Element: HTMLElement;
  Args: {
    summaryText: string;
    viewOptions: ViewOption[];
    activeViewId: string;
    activeSort: SortOption;
    sortOptions: SortOption[];
    onChangeView: (id: string) => void;
    onChangeSort: (option: SortOption) => void;
    multiSelect?: boolean;
    selectedCards?: (string | NewCardArgs)[];
    allCards?: string[];
    onSelectAll?: (cards: string[]) => void;
    onDeselectAll?: () => void;
  };
  Blocks: {};
}

export default class SearchResultHeader extends Component<Signature> {
  get selectedCount(): number {
    return this.args.selectedCards?.length ?? 0;
  }

  // The selection menu only makes sense once something is selected — its
  // trigger shows the count and its items act on the current selection.
  get showSelectionMenu(): boolean {
    return Boolean(this.args.multiSelect) && this.selectedCount > 0;
  }

  // The trigger's visible text is just the count, so spell the control out
  // for assistive tech (and include the count it stands in for).
  get selectionMenuLabel(): string {
    let count = this.selectedCount;
    return `Selection menu, ${count} card${count === 1 ? '' : 's'} selected`;
  }

  <template>
    <header class='search-result-header' data-test-search-result-header>
      <div class='summary' data-test-search-label>{{@summaryText}}</div>
      <div class='controls'>
        {{#if this.showSelectionMenu}}
          <div class='selection-menu'>
            <BoxelDropdown
              @contentClass='selection-dropdown-content'
              @matchTriggerWidth={{false}}
            >
              <:trigger as |bindings|>
                <button
                  type='button'
                  class='selection-dropdown-trigger'
                  aria-label={{this.selectionMenuLabel}}
                  {{bindings}}
                  data-test-selection-dropdown-trigger
                >
                  <SelectionCheckmarkIcon class='selection-trigger-icon' />
                  <span class='selection-trigger-text'>
                    {{this.selectedCount}}
                  </span>
                  <DropdownArrowDown
                    class='dropdown-arrow'
                    width='13px'
                    height='13px'
                  />
                </button>
              </:trigger>
              <:content as |dd|>
                <Menu
                  class='selection-menu'
                  @items={{this.selectionMenuItems}}
                  @closeMenu={{dd.close}}
                />
              </:content>
            </BoxelDropdown>
          </div>
        {{/if}}
        <ViewSelector
          @items={{@viewOptions}}
          @selectedId={{@activeViewId}}
          @onChange={{@onChangeView}}
        />
        <SortDropdown
          @options={{@sortOptions}}
          @selectedOption={{@activeSort}}
          @onSelect={{@onChangeSort}}
        />
      </div>
    </header>
    <style scoped>
      .search-result-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--boxel-sp);
        padding-block: var(--boxel-sp-lg);
        border-bottom: 1px solid var(--boxel-200);
      }
      .summary {
        font: 600 var(--boxel-font);
      }
      .controls {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--boxel-sp-lg);
        --boxel-view-option-column-gap: var(--boxel-sp-xs);
        --boxel-radio-input-option-padding: var(--boxel-sp-xs);
      }
      .controls :deep(.view-options-label) {
        display: none;
      }
      .controls :deep(.view-option) {
        --boxel-radio-input-option-padding: 0;
      }
      .controls :deep(.sort-options-group) {
        gap: var(--boxel-sp-xs);
      }
      .controls :deep(.sort-button) {
        min-width: 140px;
        gap: var(--boxel-sp-xs);
      }

      /* Primary dropdown trigger (not a flat pill): the highlight fill
         with its readable foreground, deepening on hover and while the
         menu is open. Modeled on the boxel-ui primary button / highlight
         ContextButton so it reads as a standard dropdown control rather
         than a one-off chip. */
      .selection-dropdown-trigger {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        min-height: 2rem;
        padding-inline: var(--boxel-sp-xs);
        border: none;
        border-radius: var(--boxel-border-radius-sm);
        background-color: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
        font: 700 var(--boxel-font-sm);
        cursor: pointer;
        transition: background-color var(--boxel-transition);
      }
      .selection-dropdown-trigger:hover,
      .selection-dropdown-trigger[aria-expanded='true'] {
        background-color: var(--boxel-highlight-hover);
      }
      /* Keyboard focus shows a ring just outside the button; the fill is
         not darkened on focus (deepening is reserved for hover / open). */
      .selection-dropdown-trigger:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
      .selection-trigger-icon {
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
      }
      .selection-trigger-text {
        line-height: 1;
        white-space: nowrap;
      }
      .dropdown-arrow {
        flex-shrink: 0;
        transition: transform var(--boxel-transition);
      }
      /* Caret flips to point up while the menu is open, matching the
         standard dropdown affordance. */
      .selection-dropdown-trigger[aria-expanded='true'] .dropdown-arrow {
        transform: rotate(180deg);
      }
      .selection-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
    </style>
  </template>

  private get selectionMenuItems() {
    return [
      // Inert teal header echoing the trigger's count — uses the same
      // dark-circle-with-teal-check artwork as the Adorn selection chip.
      new MenuItem({
        label: `${this.selectedCount} Selected`,
        action: () => {},
        icon: SelectionCheckmarkIcon,
        header: true,
      }),
      new MenuItem({
        label: 'Select All',
        action: () => {
          if (this.args.allCards && this.args.onSelectAll) {
            this.args.onSelectAll(this.args.allCards);
          }
        },
        icon: SelectAllIcon,
      }),
      new MenuItem({
        label: 'Deselect All',
        action: () => this.args.onDeselectAll?.(),
        icon: DeselectIcon,
      }),
    ];
  }
}
