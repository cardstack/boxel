import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { tracked } from '@glimmer/tracking';

import {
  CardDef,
  Component,
  type CardOrFieldTypeIcon,
  field,
  contains,
  linksTo,
  linksToMany,
  StringField,
  realmInfo,
} from '@cardstack/base/card-api';
import { CardsGrid } from '@cardstack/base/cards-grid';
import setBackgroundImage from '@cardstack/base/helpers/set-background-image';

import { TabbedHeader } from '@cardstack/boxel-ui/components';
import { cn, eq, not } from '@cardstack/boxel-ui/helpers';

import LayoutGridPlus from '@cardstack/boxel-icons/layout-grid-plus';
import SquareKanban from '@cardstack/boxel-icons/square-kanban';
import SquareStack from '@cardstack/boxel-icons/square-stack';

import { Overview } from './overview.gts';
import { EmptyState } from './empty-state.gts';
import { Issue, IssueTracker, Project } from './issue-tracker.gts';

const TABS = [
  { displayName: 'Overview', tabId: 'overview' },
  { displayName: 'Board', tabId: 'board' },
  { displayName: 'Artifacts', tabId: 'artifacts' },
];

interface TabEmptyStateSignature {
  Element: HTMLDivElement;
  Args: {
    icon: CardOrFieldTypeIcon;
    title: string;
    // The lede paragraph; the "watch setup progress" hint is shared.
    lede: string;
  };
}

// Shown on a tab before the factory's bootstrap populates it, so the realm
// doesn't open onto a blank panel. Owns the scrollable shell and the spacing
// that keeps the hero aligned with the Overview tab — defined once here so the
// Board and Artifacts tabs can't drift apart.
const TabEmptyState: TemplateOnlyComponent<TabEmptyStateSignature> = <template>
  <div class='tab-empty' ...attributes>
    <EmptyState @icon={{@icon}} @title={{@title}} @badgeLabel='Bootstrapping'>
      <p class='tab-empty-lede'>{{@lede}}</p>
      <p class='tab-empty-hint'>
        Head to the
        <strong>Overview</strong>
        tab to watch setup progress.
      </p>
    </EmptyState>
  </div>
  <style scoped>
    .tab-empty {
      height: 100%;
      overflow-y: auto;
      padding: calc(var(--boxel-sp-lg) * 2) var(--boxel-sp-lg)
        var(--boxel-sp-lg);
    }
    .tab-empty-lede {
      margin: 0;
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--muted-foreground, var(--boxel-500));
    }
    .tab-empty-hint {
      margin: 0;
      font-size: 0.75rem;
      line-height: 1.5;
      color: var(--card-foreground, var(--boxel-700));
    }
  </style>
</template>;

class RealmDashboardIsolated extends Component<typeof RealmDashboard> {
  @tracked activeTabId = 'overview';

  setActiveTab = (tabId: string): void => {
    this.activeTabId = tabId;
  };

  <template>
    <div class='factory-index'>
      <TabbedHeader
        class={{cn
          'factory-index-header'
          factory-index-header--no-logo=(not @model.cardThumbnailURL)
        }}
        @headerTitle={{@model.cardInfo.name}}
        @tabs={{TABS}}
        @activeTabId={{this.activeTabId}}
        @setActiveTab={{this.setActiveTab}}
      >
        <:headerIcon>
          {{#if @model.cardThumbnailURL}}
            <div
              class='factory-index-header-logo'
              style={{setBackgroundImage @model.cardThumbnailURL}}
            />
          {{/if}}
        </:headerIcon>
      </TabbedHeader>
      <div class='tab-panel'>
        {{#if (eq this.activeTabId 'overview')}}
          <Overview
            @model={{@model}}
            @fields={{@fields}}
            @context={{@context}}
          />
        {{else if (eq this.activeTabId 'board')}}
          <div class='content-panel board-panel'>
            {{#if @model.board}}
              <@fields.board @format='isolated' @displayContainer={{false}} />
            {{else}}
              <TabEmptyState
                @icon={{SquareKanban}}
                @title='No board yet'
                @lede='The factory sets up an issue tracker while it bootstraps this realm. Once that runs, the kanban board lands here — your backlog laid out across To Do, In Progress, Blocked, and Done, with every issue draggable between columns.'
                data-test-board-empty
              />
            {{/if}}
          </div>
        {{else}}
          <div class='content-panel catalog-panel'>
            {{#if @model.cardsGrid}}
              <@fields.cardsGrid
                @format='isolated'
                @displayContainer={{false}}
              />
            {{else}}
              <TabEmptyState
                @icon={{SquareStack}}
                @title='No artifacts yet'
                @lede='As the factory implements each issue, the cards it produces land here — card definitions, instances, and other realm artifacts browsable in one place.'
                data-test-artifacts-empty
              />
            {{/if}}
          </div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .factory-index {
        --boxel-header-background: var(--muted, var(--boxel-100));
        --boxel-header-foreground: var(--foreground, var(--boxel-dark));
        height: 100%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
      }
      .factory-index-header--no-logo .factory-index-header-logo {
        display: none;
      }
      .factory-index-header-logo {
        background-position: center;
        background-repeat: no-repeat;
        background-size: contain;
        width: var(--boxel-icon-med);
        height: var(--boxel-icon-med);
        aspect-ratio: 1;
      }
      .factory-index-header {
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .factory-index-header :deep(.app-content) {
        gap: 0;
      }
      .tab-panel {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .content-panel {
        height: 100%;
        overflow: hidden;
      }
      .content-panel > :deep(.boxel-card-container.isolated-format) {
        border-radius: 0;
      }
    </style>
  </template>
}

// Index page for the new realm created for a factory run
export class RealmDashboard extends CardDef {
  static icon = LayoutGridPlus;
  static displayName = 'Overview';
  static prefersWideFormat = true;

  @field cardTitle = contains(StringField, {
    computeVia: function (this: RealmDashboard) {
      return this.cardInfo.name ?? this[realmInfo]?.name;
    },
  });
  @field cardsGrid = linksTo(() => CardsGrid);
  @field board = linksTo(() => IssueTracker);

  // The board's project, surfaced as a direct computed link so the Overview can
  // render it as a clickable card atom via `<@fields.project>`. The nested
  // `<@fields.board.project>` path can't render it — a `linksTo` two hops down
  // isn't carried into the field graph — but reading it here (through the model)
  // loads the instance onto this card's own field.
  @field project = linksTo(() => Project, {
    computeVia: function (this: RealmDashboard) {
      return this.board?.project;
    },
  });

  // Filtered/sorted projections of the board's issues, materialized as computed
  // links so the Overview widgets can render them through `<@fields>`. Reading
  // the instances here (via the model) loads them, which the nested
  // `<@fields.board.project.issues>` path can't do on its own.
  @field blockedIssues = linksToMany(() => Issue, {
    computeVia: function (this: RealmDashboard) {
      let issues = this.board?.project?.issues ?? [];
      return issues.filter(
        (issue) =>
          issue?.status === 'blocked' || (issue?.blockedBy?.length ?? 0) > 0,
      );
    },
  });

  @field recentIssues = linksToMany(() => Issue, {
    computeVia: function (this: RealmDashboard) {
      let issues = this.board?.project?.issues ?? [];
      return [...issues]
        .sort((a, b) => {
          let aTime = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          let bTime = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, 8);
    },
  });

  static isolated = RealmDashboardIsolated;
}
