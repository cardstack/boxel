import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';

import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  Theme,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { CardsGrid } from 'https://cardstack.com/base/cards-grid';

import { TabbedHeader } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import LayoutGridPlus from '@cardstack/boxel-icons/layout-grid-plus';
import Factory from '@cardstack/boxel-icons/factory';

import {
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
  type RealmResourceIdentifier,
  type RenderableSearchEntryLike,
} from '@cardstack/runtime-common';

import IssueTrackerBoard from './issue-tracker-board';
import { issueStatusOptions as columns } from './kanban-config';

const TABS = [
  { displayName: 'Board', tabId: 'board' },
  { displayName: 'Catalog', tabId: 'catalog' },
];

class FactoryIndexIsolated extends Component<typeof FactoryIndex> {
  @tracked activeTabId = 'board';
  @tracked hideEmpty = false;

  setActiveTab = (tabId: string): void => {
    this.activeTabId = tabId;
  };

  toggleHideEmpty = (): void => {
    this.hideEmpty = !this.hideEmpty;
  };

  openCard = (entries: RenderableSearchEntryLike[], index: number): void => {
    let entry = entries[index];
    if (entry?.id) {
      this.args.viewCard?.(new URL(entry.id), 'isolated');
    }
  };

  // When a factory run is active, query Issues from the target realm so the
  // board shows live progress as the factory agent creates cards.
  get factoryRunIssuesQuery(): SearchEntryWireQuery {
    let targetRealmUrl = this.args.model.targetRealmUrl;
    if (!targetRealmUrl) {
      return searchEntryWireQueryFromQuery({});
    }
    let origin = new URL(targetRealmUrl).origin;
    let moduleString =
      `${origin}/software-factory/issue-tracker` as RealmResourceIdentifier;
    return {
      ...searchEntryWireQueryFromQuery(
        {
          filter: {
            type: {
              module: moduleString,
              name: 'Issue',
            },
          },
        },
        // Request fitted HTML for rendering AND the status field so the
        // board can place each issue in the correct column.
        { fields: ['html', 'item.status'] },
      ),
      realms: [targetRealmUrl],
    };
  }

  <template>
    <div class='factory-index'>
      <TabbedHeader
        @headerTitle={{@model.cardTitle}}
        @headerBackgroundColor={{@model.constructor.headerColor}}
        @tabs={{TABS}}
        @activeTabId={{this.activeTabId}}
        @setActiveTab={{this.setActiveTab}}
      >
        <:headerIcon>
          <Factory class='header-icon' aria-hidden='true' />
        </:headerIcon>
      </TabbedHeader>

      <div class='tab-panel'>
        {{#if (eq this.activeTabId 'board')}}
          <div class='board-panel'>
            {{#if @model.targetRealmUrl}}
              <div class='live-run-panel'>
                <@context.searchResultsComponent
                  @query={{this.factoryRunIssuesQuery}}
                  @mode='none'
                  as |results|
                >
                  {{#if results.isLoading}}
                    <p class='empty-state'>Loading issue tracker board…</p>
                  {{else}}
                    <div class='preject-board'>
                      {{#if results.entries}}
                        <IssueTrackerBoard
                          @boardTitle={{@model.boardTitle}}
                          @cards={{results.entries}}
                          @columns={{columns}}
                          @hideEmpty={{this.hideEmpty}}
                          @onToggleHideEmpty={{this.toggleHideEmpty}}
                          @onOpen={{fn this.openCard results.entries}}
                        />
                      {{else}}
                        <p class='empty-state'>No issues yet. The factory is
                          starting up…</p>
                      {{/if}}
                    </div>
                  {{/if}}
                </@context.searchResultsComponent>
              </div>
            {{else}}
              <p class='empty-state'>No issue tracker linked. Edit this card to
                connect one.</p>
            {{/if}}
          </div>
        {{else}}
          <div class='catalog-panel'>
            {{#if @model.cardsGrid}}
              <@fields.cardsGrid
                @format='isolated'
                @displayContainer={{false}}
              />
            {{else}}
              <p class='empty-state'>No catalog linked. Edit this card to
                connect one.</p>
            {{/if}}
          </div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .factory-index {
        height: 100%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
      }
      .header-icon {
        width: 1.25rem;
        height: 1.25rem;
        flex-shrink: 0;
      }
      .tab-panel {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .board-panel,
      .catalog-panel {
        height: 100%;
        overflow: hidden;
      }
      .live-run-panel {
        height: 100%;
        overflow-y: auto;
      }
      .empty-state {
        padding: var(--boxel-sp-xl);
        text-align: center;
        color: var(--muted-foreground, var(--boxel-500));
        font-size: 0.875rem;
      }
      .preject-board {
        height: 100%;
      }
    </style>
  </template>
}

export class FactoryIndex extends CardDef {
  static displayName = 'Factory Index';
  static icon = LayoutGridPlus;
  static prefersWideFormat = true;
  static headerColor = '#ffba00';

  @field cardsGrid = linksTo(() => CardsGrid);
  @field targetRealmUrl = contains(StringField);
  @field boardTitle = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: FactoryIndex) {
      return this.cardInfo.name?.trim() ?? 'Software Factory';
    },
  });

  @field cardTheme = linksTo(() => Theme, {
    computeVia: function (this: FactoryIndex) {
      return this.cardInfo?.theme;
    },
  });

  static isolated = FactoryIndexIsolated;
}
