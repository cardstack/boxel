import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { SortDropdown, ViewSelector } from '@cardstack/boxel-ui/components';

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
  };
  Blocks: {};
}

const SearchResultHeader: TemplateOnlyComponent<Signature> = <template>
  <header class='search-result-header' data-test-search-result-header>
    <div class='summary' data-test-search-label>{{@summaryText}}</div>
    <div class='controls'>
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
      padding: var(--boxel-sp-lg) 0;
      margin-bottom: var(--boxel-sp);
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
</template>;

export default SearchResultHeader;
