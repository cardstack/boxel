import { tracked } from '@glimmer/tracking';

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
import SquareKanban from '@cardstack/boxel-icons/square-kanban';

import {
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import { IssueTracker } from './issue-tracker';
import IssueTrackerBoard from './issue-tracker-board';
import { issueStatusOptions as columns } from './kanban-config';

const TABS = [
  { displayName: 'Issues', tabId: 'issues' },
  { displayName: 'Catalog', tabId: 'catalog' },
];

class FactoryIndexIsolated extends Component<typeof FactoryIndex> {
  @tracked activeTabId = 'issues';

  setActiveTab = (tabId: string): void => {
    this.activeTabId = tabId;
  };

  get factoryRunProjectQuery(): SearchEntryWireQuery {
    let targetRealmUrl = this.args.model.targetRealmUrl;
    if (!targetRealmUrl) {
      return searchEntryWireQueryFromQuery({});
    }
    let origin = new URL(targetRealmUrl).origin;
    let moduleString =
      `${origin}/software-factory/issue-tracker` as RealmResourceIdentifier;
    return {
      ...searchEntryWireQueryFromQuery({
        filter: {
          type: {
            module: moduleString,
            name: 'Project',
          },
        },
      }),
      realms: [targetRealmUrl],
    };
  }

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
        @tabs={{TABS}}
        @activeTabId={{this.activeTabId}}
        @setActiveTab={{this.setActiveTab}}
      >
        <:headerIcon>
          {{#if (eq this.activeTabId 'issues')}}
            <SquareKanban class='header-icon' aria-hidden='true' />
          {{else}}
            <LayoutGridPlus class='header-icon' aria-hidden='true' />
          {{/if}}
        </:headerIcon>
      </TabbedHeader>

      <div class='tab-panel'>
        {{#if (eq this.activeTabId 'issues')}}
          <div class='board-panel'>
            {{#if @model.targetRealmUrl}}
              <div class='live-run-panel'>
                <@context.searchResultsComponent
                  @query={{this.factoryRunProjectQuery}}
                  @mode='none'
                  as |projectResults|
                >
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
                            @cardTitle={{@model.cardTitle}}
                            @project={{projectResults.entries.[0]}}
                            @cards={{results.entries}}
                            @columns={{columns}}
                          />
                        {{else}}
                          <p class='empty-state'>No issues yet. The factory is
                            starting up…</p>
                        {{/if}}
                      </div>
                    {{/if}}
                  </@context.searchResultsComponent>
                </@context.searchResultsComponent>
              </div>
            {{else if @model.issueTracker}}
              <@fields.issueTracker @format='isolated' />
            {{else}}
              <p class='empty-state'>No issue tracker linked. Edit this card to
                connect one.</p>
            {{/if}}
          </div>
        {{else}}
          <div class='catalog-panel'>
            {{#if @model.cardsGrid}}
              <@fields.cardsGrid @format='isolated' />
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
        padding: var(--boxel-sp-lg);
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
      .project-container {
        height: 100%;
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        border: 1px solid var(--border, var(--boxel-border-color));
      }
    </style>
  </template>
}

export class FactoryIndex extends CardDef {
  static displayName = 'Factory Index';
  static icon = LayoutGridPlus;
  static prefersWideFormat = true;

  @field issueTracker = linksTo(() => IssueTracker);
  @field cardsGrid = linksTo(() => CardsGrid);
  @field targetRealmUrl = contains(StringField);

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
