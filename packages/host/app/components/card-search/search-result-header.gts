import Component from '@glimmer/component';

import DeselectIcon from '@cardstack/boxel-icons/deselect';
import SelectAllIcon from '@cardstack/boxel-icons/select-all';

import {
  SelectionCheckmark,
  SelectionMenu,
  SortDropdown,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';

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
  // for assistive tech. "cards" is an app concern, so it's supplied here
  // rather than baked into the generic SelectionMenu.
  get selectionMenuLabel(): string {
    let count = this.selectedCount;
    return `Selection menu, ${count} card${count === 1 ? '' : 's'} selected`;
  }

  // Select All / Deselect All are app actions, so the items (including the
  // inert count header) are built here and handed to the generic
  // SelectionMenu via @items.
  private get selectionMenuItems() {
    return [
      new MenuItem({
        label: `${this.selectedCount} Selected`,
        action: () => {},
        icon: SelectionCheckmark,
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

  <template>
    <header class='search-result-header' data-test-search-result-header>
      <div class='summary' data-test-search-label>{{@summaryText}}</div>
      <div class='controls'>
        {{#if this.showSelectionMenu}}
          <SelectionMenu
            @selectedCount={{this.selectedCount}}
            @items={{this.selectionMenuItems}}
            @label={{this.selectionMenuLabel}}
          />
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
    </style>
  </template>
}
