import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { CardContext } from 'https://cardstack.com/base/card-api';
import { Query } from '@cardstack/runtime-common';
import GlimmerComponent from '@glimmer/component';

import CardsDisplaySection from './cards-display-section';
import { CardsGrid } from './grid';

import {
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '@cardstack/boxel-ui/icons';
import { ViewSelector, type ViewItem } from '@cardstack/boxel-ui/components';

type ViewOption = 'strip' | 'grid';

const CATALOG_VIEW_OPTIONS: ViewItem[] = [
  { id: 'strip', icon: StripIcon },
  { id: 'grid', icon: GridIcon },
];

interface ListViewArgs {
  Args: {
    query: Query;
    realms: string[];
    context?: CardContext;
  };
  Element: HTMLElement;
}

export default class ListView extends GlimmerComponent<ListViewArgs> {
  @tracked private selectedView: ViewOption = 'grid';

  @action private onChangeView(id: ViewOption) {
    this.selectedView = id;
  }

  <template>
    <CardsDisplaySection data-test-catalog-list-view ...attributes>
      <:intro>
        <header class='catalog-list-header'>
          <ViewSelector
            class='catalog-list-view-selector'
            @selectedId={{this.selectedView}}
            @onChange={{this.onChangeView}}
            @items={{CATALOG_VIEW_OPTIONS}}
          />
        </header>
      </:intro>
      <:content>
        <CardsGrid
          @query={{@query}}
          @realms={{@realms}}
          @selectedView={{this.selectedView}}
          @context={{@context}}
        />
      </:content>
    </CardsDisplaySection>

    <style scoped>
      h2 {
        margin-block: 0;
        margin-bottom: var(--boxel-sp);
      }
      .catalog-list-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
        margin-bottom: var(--boxel-sp-sm);
      }
      .catalog-list-view-selector {
        margin-left: auto;
      }
    </style>
  </template>
}
