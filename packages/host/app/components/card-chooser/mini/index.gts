import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import type { Filter } from '@cardstack/runtime-common';

import SearchPanel from '@cardstack/host/components/card-search/panel';
import {
  removeFileExtension,
  type NewCardArgs,
} from '@cardstack/host/utils/card-search/types';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    initialSearchKey?: string;
    baseFilter?: Filter;
    onSelect: (url: string) => void;
    // URL of the currently selected card — the matching row gets the teal
    // selection treatment + checkmark. Omit for a chooser that surfaces
    // matches but doesn't persist a pinned selection.
    selected?: string;
  };
}

export default class MiniCardChooser extends Component<Signature> {
  @tracked private searchKey: string = this.args.initialSearchKey ?? '';

  // SearchContent expects an array (it's the multi-select API plumbing).
  // Wrap the single-select `@selected` so the existing isCardSelected check
  // in SearchResultSection picks it up without any other changes.
  private get selectedCards(): string[] | undefined {
    return this.args.selected ? [this.args.selected] : undefined;
  }

  @action
  private setSearchKey(value: string) {
    this.searchKey = value;
  }

  @action
  private handleSelect(selection: string | NewCardArgs) {
    if (typeof selection !== 'string') {
      return;
    }
    let normalized = removeFileExtension(selection);
    if (normalized) {
      this.args.onSelect(normalized);
    }
  }

  <template>
    <div class='mini-card-chooser' data-test-mini-card-chooser ...attributes>
      <SearchPanel
        @searchKey={{this.searchKey}}
        @baseFilter={{@baseFilter}}
        as |Bar Content|
      >
        <header class='mini-card-chooser__header'>
          <Bar
            @onInput={{this.setSearchKey}}
            @placeholder='Search for a card'
            @hidePickers={{true}}
          />
        </header>
        <div class='mini-card-chooser__results'>
          <Content
            @isCompact={{false}}
            @handleSelect={{this.handleSelect}}
            @showHeader={{true}}
            @variant='mini'
            @selectedCards={{this.selectedCards}}
          />
        </div>
      </SearchPanel>
    </div>
    <style scoped>
      .mini-card-chooser {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        background-color: var(--boxel-light);
        /* Share the file chooser's compact scale so the two lists match when
           toggling tabs in the markdown embed chooser. */
        font: var(--boxel-font-sm);
      }
      .mini-card-chooser__header {
        flex: 0 0 auto;
        /* Small bottom inset so the search bar's 2px focus outline isn't
           painted over by the results list sitting directly below it. */
        padding: var(--boxel-sp-xs) var(--boxel-sp-xs) var(--boxel-sp-4xs);
      }
      /* Pill-shaped, design-matched bar height. SearchBar's defaults are
         tuned for the full search-sheet (50px tall, generous focus ring);
         in the mini envelope we want a tighter pill. */
      .mini-card-chooser__header :deep(.search-sheet__search-bar) {
        min-height: 2.5rem;
        border-radius: 999px;
      }
      .mini-card-chooser__results {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
    </style>
  </template>
}
