import Component from '@glimmer/component';

import DeselectIcon from '@cardstack/boxel-icons/deselect';
import SelectAllIcon from '@cardstack/boxel-icons/select-all';

import {
  BoxelDropdown,
  Button,
  Menu,
  SortDropdown,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import type { SortOption } from './constants';
import type { ViewOption } from './constants';
import type { NewCardArgs } from './utils';

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

  <template>
    <header class='search-result-header' data-test-search-result-header>
      <div class='summary' data-test-search-label>{{@summaryText}}</div>
      <div class='controls'>
        {{#if @multiSelect}}
          <div class='selection-menu'>
            <BoxelDropdown
              @contentClass='selection-dropdown-content'
              @matchTriggerWidth={{false}}
            >
              <:trigger as |bindings|>
                <Button
                  class='selection-dropdown-trigger'
                  @kind='secondary-light'
                  {{bindings}}
                  data-test-selection-dropdown-trigger
                >
                  {{this.selectedCount}}
                  Selected
                  <DropdownArrowDown
                    class='dropdown-arrow'
                    width='12'
                    height='12'
                  />
                </Button>
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

      .selection-dropdown-trigger {
        border-radius: var(--boxel-border-radius);
        min-width: 140px;
        justify-content: flex-start;
        padding-left: var(--boxel-sp-sm);
        padding-right: var(--boxel-sp-sm);
        gap: var(--boxel-sp-xs);
        font-weight: 600;
      }
      .dropdown-arrow {
        margin-left: auto;
        flex-shrink: 0;
      }
      .selection-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
    </style>
  </template>

  private get selectionMenuItems() {
    return [
      new MenuItem({
        label: 'Deselect All',
        action: () => this.args.onDeselectAll?.(),
        icon: DeselectIcon,
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
    ];
  }
}
