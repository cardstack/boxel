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
import { htmlSafe } from '@ember/template';

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
    icon?: string | Icon;
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
          {{#if @activeFilter.icon}}
            <div class='content-icon'>
              {{#if (this.isIconString @activeFilter.icon)}}
                {{htmlSafe @activeFilter.icon}}
              {{else}}
                <@activeFilter.icon
                  class='filter-list__icon'
                  role='presentation'
                />
              {{/if}}
            </div>
          {{/if}}
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
          <div class='highlights-layout' data-test-highlights-layout>
            {{#if this.getAiAppGeneratorCard}}
              <div
                class='highlights-section'
                data-test-highlights-section='new-feature'
              >
                <h3
                  class='section-header'
                  data-test-section-header='new-feature'
                >NEW FEATURE</h3>
                <div
                  class='highlights-card-container'
                  data-test-highlights-card-container='ai-app-generator'
                >
                  <this.getAiAppGeneratorCard @format='embedded' />
                </div>

              </div>
            {{/if}}

            {{#if this.getWelcomeToBoxelCard}}
              <div
                class='highlights-section'
                data-test-highlights-section='getting-started'
              >
                <h3
                  class='section-header'
                  data-test-section-header='getting-started'
                >GETTING STARTED</h3>
                <div
                  class='highlights-card-container'
                  data-test-highlights-card-container='welcome-to-boxel'
                >
                  <div class='highlights-card-container'>
                    <this.getWelcomeToBoxelCard @format='embedded' />
                  </div>
                </div>
              </div>
            {{/if}}

            {{#if this.getCommunityCards}}
              <div
                class='highlights-section'
                data-test-highlights-section='join-community'
              >
                <h3
                  class='section-header'
                  data-test-section-header='join-the-community'
                >JOIN THE COMMUNITY</h3>
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
        background-color: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
      }
      .scroll-container {
        overflow: hidden;
      }
      .scroll-container:hover,
      .scroll-container:focus {
        overflow-y: auto;
      }
      .sidebar {
        --accent: var(--sidebar-accent);
        --accent-foreground: var(--sidebar-accent-foreground);
        --primary: var(--sidebar-primary);
        --primary-foreground: var(--sidebar-primary-foreground);
        --border: var(--sidebar-border);
        --ring: var(--sidebar-ring);
        position: relative;
        max-width: 100%;
        width: var(--sidebar-max-width);
        min-width: var(--sidebar-min-width);
        padding: var(--boxel-cards-grid-layout-sidebar-padding, var(--padding));
        background-color: var(--sidebar);
        color: var(--sidebar-foreground);
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
        column-gap: var(--boxel-sp);
        row-gap: var(--boxel-sp-xs);
        padding: var(--padding) 0;
        margin: 0 var(--padding);
        border-bottom: 1px solid #e2e2e2;
      }
      .content-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        flex-shrink: 0;
      }

      .filter-icon-svg {
        width: 1.5rem;
        height: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .filter-icon-svg svg {
        width: 1.5rem;
        height: 1.5rem;
      }

      .content-title {
        flex-grow: 1;
        margin-block: 0;
        font-size: var(--boxel-heading-font-size);
        font-weight: 500;
        line-height: var(--boxel-heading-line-height);
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

  private isIconString(icon: Icon | string | undefined): icon is string {
    return typeof icon === 'string';
  }
}
