import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import type { Filter, ResolvedCodeRef } from '@cardstack/runtime-common';

import SearchPanel from '@cardstack/host/components/card-search/panel';
import type { NewCardArgs } from '@cardstack/host/utils/card-search/types';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    searchKey?: string;
    baseFilter?: Filter;
    initialSelectedRealms?: URL[];
    initialSelectedTypes?: ResolvedCodeRef[];
    lockSelectedRealms?: boolean;
    onSelect: (url: string) => void;
    onCancel?: () => void;
  };
}

function normalizeCardUrl(url: string): string {
  return url.replace(/\.json$/, '');
}

export default class MiniCardChooser extends Component<Signature> {
  @tracked private searchKey: string = this.args.searchKey ?? '';

  @action
  private setSearchKey(value: string) {
    this.searchKey = value;
  }

  @action
  private handleSelect(selection: string | NewCardArgs) {
    if (typeof selection !== 'string') {
      return;
    }
    this.args.onSelect(normalizeCardUrl(selection));
  }

  <template>
    <div class='mini-card-chooser' data-test-mini-card-chooser ...attributes>
      <SearchPanel
        @searchKey={{this.searchKey}}
        @baseFilter={{@baseFilter}}
        @initialSelectedRealms={{@initialSelectedRealms}}
        @initialSelectedTypes={{@initialSelectedTypes}}
        @lockSelectedRealms={{@lockSelectedRealms}}
        as |Bar Content|
      >
        <header class='mini-card-chooser__header'>
          <Bar
            @onInput={{this.setSearchKey}}
            @placeholder='Search for a card'
          />
        </header>
        <div class='mini-card-chooser__results'>
          <Content
            @isCompact={{false}}
            @handleSelect={{this.handleSelect}}
            @showHeader={{true}}
            @adorn={{true}}
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
      }
      .mini-card-chooser__header {
        flex: 0 0 auto;
        padding: var(--boxel-sp-xs);
      }
      .mini-card-chooser__results {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .mini-card-chooser :deep(.search-sheet__search-bar-picker),
      .mini-card-chooser :deep(.search-sheet__search-bar-separator) {
        display: none;
      }
    </style>
  </template>
}
