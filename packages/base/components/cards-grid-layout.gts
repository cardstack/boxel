import Component from '@glimmer/component';

import {
  FilterList,
  SortDropdown,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import {
  Card as CardViewIcon,
  Grid3x3 as GridViewIcon,
  Rows4 as StripViewIcon,
  type Icon,
} from '@cardstack/boxel-ui/icons';

import {
  baseRealm,
  type Format,
  type Query,
  type Sort,
} from '@cardstack/runtime-common';

import type { CardContext, BoxComponent } from '../card-api';

import CardList from './card-list';

export interface ViewOption {
  id: string;
  icon: Icon;
}

export interface SortOption {
  displayName: string;
  sort: Sort;
}

export interface FilterOption {
  displayName: string;
  icon?: Icon | string;
  query?: Query;
  cards?: BoxComponent[];
  filters?: FilterOption[];
  isExpanded?: boolean;
}

export const SORT_OPTIONS: SortOption[] = [
  {
    displayName: 'A-Z',
    sort: [
      {
        on: {
          module: `${baseRealm.url}card-api`,
          name: 'CardDef',
        },
        by: 'title',
        direction: 'asc',
      },
    ],
  },
  {
    displayName: 'Last Updated',
    sort: [
      {
        by: 'lastModified',
        direction: 'desc',
      },
    ],
  },
  {
    displayName: 'Date Created',
    sort: [
      {
        by: 'createdAt',
        direction: 'desc',
      },
    ],
  },
];

export const VIEW_OPTIONS = [
  { id: 'card', icon: CardViewIcon },
  { id: 'strip', icon: StripViewIcon },
  { id: 'grid', icon: GridViewIcon },
];

interface Signature {
  Args: {
    context?: CardContext;
    format: Format;
    query?: Query;
    realms: string[];
    isLive?: boolean;
    filterOptions: FilterOption[];
    sortOptions: SortOption[];
    viewOptions: ViewOption[];
    activeFilter: FilterOption;
    activeSort: SortOption;
    activeViewId: ViewOption['id'];
    onChangeFilter: (filter: FilterOption) => void;
    onChangeSort: (sort: SortOption) => void;
    onChangeView: (viewId: ViewOption['id']) => void;
  };
  Blocks: { content: []; contentHeader: []; sidebar: [] };
  Element: HTMLElement;
}

export default class CardsGridLayout extends Component<Signature> {
  <template>
    <section class='boxel-cards-grid-layout' ...attributes>
      <aside class='sidebar scroll-container' tabindex='0'>
        <FilterList
          @filters={{@filterOptions}}
          @activeFilter={{@activeFilter}}
          @onChanged={{@onChangeFilter}}
        />
        {{yield to='sidebar'}}
      </aside>
      <section class='content scroll-container' tabindex='0'>
        <header class='content-header' aria-label={{@activeFilter.displayName}}>
          <h2 class='content-title'>
            {{@activeFilter.displayName}}
          </h2>
          {{#if this.displayActions}}
            <ViewSelector
              @items={{@viewOptions}}
              @onChange={{@onChangeView}}
              @selectedId={{@activeViewId}}
            />
            <SortDropdown
              @options={{@sortOptions}}
              @onSelect={{@onChangeSort}}
              @selectedOption={{@activeSort}}
            />
            {{yield to='contentHeader'}}
          {{/if}}
        </header>
        {{#if (eq @activeFilter.displayName 'Highlights')}}
          <div class='highlights-layout'>
            {{#if this.getAiAppGeneratorCard}}
              <div class='highlights-section'>
                <h3 class='section-header'>NEW FEATURE</h3>
                <div class='highlights-card-container'>
                  <this.getAiAppGeneratorCard @format='embedded' />
                </div>

              </div>
            {{/if}}

            {{#if this.getWelcomeToBoxelCard}}
              <div class='highlights-section'>
                <h3 class='section-header'>GETTING STARTED</h3>
                <div class='highlights-card-container'>
                  <div class='highlights-card-container'>
                    <this.getWelcomeToBoxelCard @format='embedded' />
                  </div>
                </div>
              </div>
            {{/if}}

            {{#if this.getCommunityCards}}
              <div class='highlights-section'>
                <this.getCommunityCards @format='embedded' />
              </div>
            {{/if}}
          </div>
        {{else}}
          <CardList
            class='cards'
            @context={{@context}}
            @query={{@query}}
            @realms={{@realms}}
            @isLive={{@isLive}}
            @format={{@format}}
            @cards={{@activeFilter.cards}}
            @viewOption={{@activeViewId}}
            data-test-cards-grid-cards
          />
        {{/if}}
        {{#if this.displayActions}}
          {{yield to='content'}}
        {{/if}}
      </section>
    </section>

    <style scoped>
      .boxel-cards-grid-layout {
        --padding: var(--boxel-cards-grid-layout-padding, var(--boxel-sp-lg));
        --boxel-card-list-padding: var(
          --boxel-cards-grid-padding,
          0 var(--padding)
        );
        --sidebar-min-width: var(--boxel-cards-grid-sidebar-min-width, 11rem);
        --sidebar-max-width: var(--boxel-cards-grid-sidebar-max-width, 22rem);

        position: relative;
        display: flex;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100vh;
        overflow: hidden;
      }
      .scroll-container {
        overflow: hidden;
      }
      .scroll-container:hover,
      .scroll-container:focus {
        overflow-y: auto;
      }
      .sidebar {
        position: relative;
        max-width: 100%;
        width: var(--sidebar-max-width);
        min-width: var(--sidebar-min-width);
        padding: var(--boxel-cards-grid-layout-sidebar-padding, var(--padding));
      }
      .content {
        position: relative;
        flex-grow: 1;
        display: grid;
        grid-template-rows: auto 1fr;
        gap: var(--boxel-sp-lg);
        width: 100%;
        max-width: 100%;
      }
      .content-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        column-gap: var(--boxel-sp-lg);
        row-gap: var(--boxel-sp-xs);
        padding: var(--padding);
      }
      .content-title {
        flex-grow: 1;
        margin-block: 0;
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-xxs);
      }

      .highlights-layout {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: 0 var(--padding) var(--padding) var(--padding);

        width: 100%;
      }

      .highlights-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        width: 100%;
      }

      .section-header {
        margin: 0;
        font: 600 var(--boxel-font);
        color: var(--boxel-dark);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xs);
      }

      .highlights-card-container {
        width: 100%;
      }
    </style>
  </template>

  private get displayActions() {
    return this.args.activeFilter.displayName !== 'Highlights';
  }

  private get getWelcomeToBoxelCard() {
    return this.args.activeFilter.cards?.[0];
  }

  private get getAiAppGeneratorCard() {
    return this.args.activeFilter.cards?.[1];
  }

  private get getCommunityCards() {
    return this.args.activeFilter.cards?.[2];
  }
}
