import { tracked } from '@glimmer/tracking';
import { dropTask } from 'ember-concurrency';
import { get } from '@ember/helper';
import { on } from '@ember/modifier';
import Owner from '@ember/owner';

import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  Theme,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateTimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import TextAreaField from 'https://cardstack.com/base/text-area';

import { ContextButton, FieldContainer } from '@cardstack/boxel-ui/components';

import { realmURL, type ResolvedCodeRef } from '@cardstack/runtime-common';
import LayoutSidebarRightCollapse from '@cardstack/boxel-icons/layout-sidebar-right-collapse';
import LayoutSidebarRightExpand from '@cardstack/boxel-icons/layout-sidebar-right-expand';

import { IssueOptionField } from './issue-option';
import { KanbanColumnField } from './kanban-column';
import { KanbanPlane } from '@cardstack/boxel-ui/components';
import { StatusPill } from './status-pill';
import { ProjectKanbanController } from './project-kanban-controller';
import { ProjectKanbanSettingsPanel } from './project-kanban-settings-panel';
import { ProjectKanbanToolbar } from './project-kanban-toolbar';

import {
  type Option,
  issueStatusOptions,
  issueTypeOptions,
  issuePriorityOptions,
  findOptionColor,
  buildIssueOptionFields,
  IssueStatusField,
  IssueTypeField,
  IssuePriorityField,
  ProjectStatusField,
  GroupByField,
  projectStatusOptions,
} from './kanban-config';
import { Comment } from './comment';
import { KnowledgeArticle } from './knowledge-article';

export { AgentProfile } from './agent-profile';
export { KnowledgeArticle } from './knowledge-article';
export { Comment } from './comment';
export { KnowledgeTypeField } from './knowledge-article';

const issueCodeRef: ResolvedCodeRef = {
  // @ts-expect-error this is not a CJS file, import.meta is allowed
  module: new URL('./darkfactory', import.meta.url).href,
  name: 'Issue',
};

function issueStatusColor(
  statusOptions: IssueOptionField[] | undefined,
  status: string | null | undefined,
): string | undefined {
  return findOptionColor(
    statusOptions?.length ? (statusOptions as Option[]) : issueStatusOptions,
    status ?? 'backlog',
  );
}

class IssueIsolated extends Component<typeof Issue> {
  @tracked showSidebar = true;

  get statusColor(): string | undefined {
    const project = this.args.model?.project;
    return issueStatusColor(
      project?.issueStatusOptions,
      this.args.model?.status,
    );
  }

  toggleSidebar = () => {
    this.showSidebar = !this.showSidebar;
  };

  <template>
    <div class='issue-isolated'>
      <header class='issue-header'>
        <div class='header-chips'>
          <span class='id-chip'>{{if
              @model.issueId
              @model.issueId
              'ISSUE'
            }}</span>
          {{#if @model.issueType}}
            <span class='type-chip'><@fields.issueType @format='atom' /></span>
          {{/if}}
          <StatusPill @color={{this.statusColor}}>
            {{#if @model.status}}
              <@fields.status @format='atom' />
            {{else}}
              Backlog
            {{/if}}
          </StatusPill>
          <ContextButton
            class='sidebar-toggle'
            @icon={{if
              this.showSidebar
              LayoutSidebarRightCollapse
              LayoutSidebarRightExpand
            }}
            @label={{if this.showSidebar 'Collapse sidebar' 'Expand sidebar'}}
            @variant='ghost'
            {{on 'click' this.toggleSidebar}}
          />
        </div>
        <h1 class='issue-title'><@fields.cardTitle /></h1>
      </header>

      <div
        class='issue-body'
        data-sidebar={{if this.showSidebar 'open' 'closed'}}
      >
        <main class='issue-main'>
          <section class='content-section'>
            <h2 class='section-heading'>Description</h2>
            <div class='section-body'>
              {{#if @model.description}}
                <@fields.description />
              {{else}}
                <p class='empty-section-text'>
                  No description yet. Add context, goals, constraints, or links
                  in edit mode.
                </p>
              {{/if}}
            </div>
          </section>
          {{#if @model.acceptanceCriteria}}
            <section class='content-section'>
              <h2 class='section-heading'>Acceptance Criteria</h2>
              <div class='section-body'>
                <@fields.acceptanceCriteria />
              </div>
            </section>
          {{/if}}
          {{#if @model.comments.length}}
            <section class='content-section'>
              <h2 class='section-heading'>
                Comments
                <span class='count-badge'>{{@model.comments.length}}</span>
              </h2>
              <div class='comments-list'>
                <@fields.comments />
              </div>
            </section>
          {{/if}}
        </main>

        <aside class='issue-sidebar'>
          <div class='issue-sidebar-inner'>
            <dl class='meta-list'>
              <div class='meta-item'>
                <dt>Status</dt>
                <dd>
                  <StatusPill @color={{this.statusColor}}>
                    {{#if @model.status}}
                      <@fields.status @format='atom' />
                    {{else}}
                      Backlog
                    {{/if}}
                  </StatusPill>
                </dd>
              </div>
              {{#if @model.priority}}
                <div class='meta-item'>
                  <dt>Priority</dt>
                  <dd>
                    <span
                      class='priority-value'
                      data-priority={{@model.priority}}
                    >
                      <@fields.priority @format='atom' />
                    </span>
                  </dd>
                </div>
              {{/if}}
              {{#if @model.issueType}}
                <div class='meta-item'>
                  <dt>Type</dt>
                  <dd><@fields.issueType @format='atom' /></dd>
                </div>
              {{/if}}
              {{#if @model.createdAt}}
                <div class='meta-item'>
                  <dt>Created</dt>
                  <dd class='meta-date'><@fields.createdAt
                      @format='atom'
                    /></dd>
                </div>
              {{/if}}
              {{#if @model.updatedAt}}
                <div class='meta-item'>
                  <dt>Updated</dt>
                  <dd class='meta-date'><@fields.updatedAt
                      @format='atom'
                    /></dd>
                </div>
              {{/if}}
            </dl>

            {{#if @model.project}}
              <div class='sidebar-section'>
                <h3 class='sidebar-section-title'>Project</h3>
                <div class='sidebar-card'>
                  <@fields.project @format='embedded' />
                </div>
              </div>
            {{/if}}

            {{#if @model.blockedBy.length}}
              <div class='sidebar-section'>
                <h3 class='sidebar-section-title'>Blocked By</h3>
                <div class='related-list'>
                  <@fields.blockedBy />
                </div>
              </div>
            {{/if}}

            {{#if @model.relatedKnowledge.length}}
              <div class='sidebar-section'>
                <h3 class='sidebar-section-title'>Related Knowledge</h3>
                <div class='related-list'>
                  <@fields.relatedKnowledge />
                </div>
              </div>
            {{/if}}
          </div>
        </aside>
      </div>
    </div>
    <style scoped>
      .issue-isolated {
        height: 100%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
      }
      .issue-header {
        padding: var(--boxel-sp-xl) var(--boxel-sp-xl) var(--boxel-sp-lg);
        background: var(--muted, var(--boxel-100));
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
        display: grid;
        gap: var(--boxel-sp-2xs);
      }
      .header-chips {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        flex-wrap: wrap;
      }
      .sidebar-toggle {
        margin-left: auto;
        flex-shrink: 0;
      }
      .id-chip {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .type-chip {
        font-size: 0.6875rem;
        font-weight: 500;
        color: var(--muted-foreground, var(--boxel-500));
        background: color-mix(
          in oklch,
          var(--muted-foreground, var(--boxel-500)) 12%,
          transparent
        );
        padding: 0.2em 0.6em;
        border-radius: 4px;
        text-transform: capitalize;
      }
      .issue-title {
        margin: 0;
        font-size: 1.375rem;
        font-weight: 600;
        line-height: 1.3;
        color: var(--foreground, var(--boxel-dark));
      }
      .issue-body {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow: hidden;
      }
      .issue-main {
        flex: 1;
        min-width: 0;
        padding: var(--boxel-sp-xl);
        display: grid;
        gap: var(--boxel-sp-xl);
        align-content: start;
        overflow-y: auto;
      }
      .content-section {
        display: grid;
        gap: var(--boxel-sp-2xs);
      }
      .section-heading {
        margin: 0;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--foreground, var(--boxel-dark));
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
      }
      .count-badge {
        font-size: 0.6875rem;
        font-weight: 500;
        color: var(--muted-foreground, var(--boxel-500));
        background: color-mix(
          in oklch,
          var(--muted-foreground, var(--boxel-500)) 15%,
          transparent
        );
        padding: 0.1em 0.5em;
        border-radius: 999px;
      }
      .section-body {
        font-size: 0.875rem;
        line-height: 1.6;
        color: var(--foreground, var(--boxel-dark));
      }
      .empty-section-text {
        margin: 0;
        padding: var(--boxel-sp);
        color: var(--muted-foreground, var(--boxel-500));
        background: color-mix(
          in oklch,
          var(--muted, var(--boxel-100)) 70%,
          transparent
        );
        border: 1px dashed var(--border, var(--boxel-border-color));
        border-radius: var(--boxel-border-radius);
      }
      .comments-list {
        display: grid;
      }
      .issue-sidebar {
        width: 18rem;
        flex-shrink: 0;
        overflow: hidden;
        border-left: 1px solid var(--border, var(--boxel-border-color));
        transition: width 0.25s ease;
      }
      .issue-sidebar-inner {
        width: 18rem;
        padding: var(--boxel-sp-lg) var(--boxel-sp);
        background: var(--sidebar, var(--boxel-50));
        color: var(--sidebar-foreground, var(--foreground, var(--boxel-dark)));
        display: grid;
        gap: var(--boxel-sp-lg);
        align-content: start;
        overflow-y: auto;
        height: 100%;
        box-sizing: border-box;
      }
      .issue-body[data-sidebar='closed'] .issue-sidebar {
        width: 0;
        border-left-width: 0;
      }
      .meta-list {
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-2xs);
      }
      .meta-item {
        display: grid;
        grid-template-columns: 5.5rem 1fr;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        min-height: 1.75rem;
      }
      .meta-list dt {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .meta-list dd {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--foreground, var(--boxel-dark));
      }
      .priority-value {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: capitalize;
        color: var(--_p, var(--foreground, var(--boxel-dark)));
      }
      .priority-value[data-priority='critical'] {
        --_p: oklch(55% 0.22 25);
      }
      .priority-value[data-priority='high'] {
        --_p: oklch(68% 0.17 55);
      }
      .priority-value[data-priority='medium'] {
        --_p: oklch(75% 0.14 90);
      }
      .priority-value[data-priority='low'] {
        --_p: var(--muted-foreground, var(--boxel-500));
      }
      .meta-date {
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .sidebar-section {
        display: grid;
        gap: var(--boxel-sp-2xs);
      }
      .sidebar-section-title {
        margin: 0;
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-500));
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .sidebar-card {
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        border: 1px solid var(--border, var(--boxel-border-color));
      }
      .related-list {
        display: grid;
        gap: var(--boxel-sp-2xs);
      }
    </style>
  </template>
}

export class Issue extends CardDef {
  static displayName = 'Issue';

  @field issueId = contains(StringField);
  @field summary = contains(StringField);
  @field description = contains(MarkdownField);
  @field issueType = contains(IssueTypeField);
  @field status = contains(IssueStatusField);
  @field priority = contains(IssuePriorityField);
  @field project = linksTo(() => Project);
  @field blockedBy = linksToMany(() => Issue);
  @field relatedKnowledge = linksToMany(() => KnowledgeArticle);
  @field acceptanceCriteria = contains(MarkdownField);
  @field order = contains(NumberField);
  @field createdAt = contains(DateTimeField);
  @field updatedAt = contains(DateTimeField);
  @field comments = containsMany(Comment);
  @field statusBoardOrder = contains(NumberField);
  @field priorityBoardOrder = contains(NumberField);
  @field issueTypeBoardOrder = contains(NumberField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Issue) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.summary ?? 'Untitled Issue');
    },
  });

  @field cardTheme = linksTo(() => Theme, {
    computeVia: function (this: Issue) {
      return this.cardInfo?.theme ?? this.project?.cardTheme;
    },
  });

  static fitted = class Fitted extends Component<typeof Issue> {
    get statusColor(): string | undefined {
      const project = this.args.model?.project as Project | null;
      return issueStatusColor(
        project?.issueStatusOptions,
        this.args.model?.status,
      );
    }

    <template>
      <div class='issue-card'>
        <div class='meta-row'>
          <span class='issue-id'>{{if
              @model.issueId
              @model.issueId
              'ISSUE'
            }}</span>
          {{#if @model.issueType}}
            <span class='type-tag'><@fields.issueType @format='atom' /></span>
          {{/if}}
        </div>
        <p class='title'><@fields.cardTitle /></p>
        <div class='footer-row'>
          {{#if @model.priority}}
            <span class='priority' data-priority={{@model.priority}}>
              <@fields.priority @format='atom' />
            </span>
          {{/if}}
          <StatusPill @color={{this.statusColor}}>
            {{#if @model.status}}
              <@fields.status @format='atom' />
            {{else}}
              Backlog
            {{/if}}
          </StatusPill>
        </div>
      </div>
      <style scoped>
        .issue-card {
          display: grid;
          grid-template-rows: auto 1fr auto;
          gap: var(--boxel-sp-2xs);
          padding: var(--boxel-sp-2xs) var(--boxel-sp-2xs) var(--boxel-sp-2xs)
            var(--boxel-sp);
          height: 100%;
          box-sizing: border-box;
        }
        .meta-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--boxel-sp-2xs);
          min-width: 0;
        }
        .issue-id {
          font-size: 0.6875rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-500));
          flex-shrink: 0;
        }
        .type-tag {
          font-size: 0.625rem;
          font-weight: 500;
          color: var(--muted-foreground, var(--boxel-500));
          background: color-mix(
            in oklch,
            var(--muted-foreground, var(--boxel-500)) 12%,
            transparent
          );
          padding: 0.15em 0.45em;
          border-radius: 3px;
          text-transform: capitalize;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 6rem;
        }
        .title {
          margin: 0;
          font-size: 0.8125rem;
          font-weight: 500;
          line-height: 1.4;
          color: var(--card-foreground, var(--boxel-dark));
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .footer-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--boxel-sp-2xs);
        }
        .priority {
          font-size: 0.625rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--_p, var(--muted-foreground, var(--boxel-500)));
        }
        .priority[data-priority='critical'] {
          --_p: oklch(55% 0.22 25);
        }
        .priority[data-priority='high'] {
          --_p: oklch(68% 0.17 55);
        }
        .priority[data-priority='medium'] {
          --_p: oklch(75% 0.14 90);
        }
        .priority[data-priority='low'] {
          --_p: var(--muted-foreground, var(--boxel-500));
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = IssueIsolated;

  static edit = class Edit extends Component<typeof Issue> {
    <template>
      <div class='issue-edit'>
        <section class='edit-section'>
          <h2 class='section-heading'>Basic Info</h2>
          <FieldContainer @label='Summary' @tag='label' @vertical={{true}}>
            <@fields.summary />
          </FieldContainer>
          <div class='field-row'>
            <FieldContainer @label='Issue ID' @tag='label' @vertical={{true}}>
              <@fields.issueId />
            </FieldContainer>
            <FieldContainer @label='Type' @tag='label' @vertical={{true}}>
              <@fields.issueType />
            </FieldContainer>
          </div>
          <div class='field-row'>
            <FieldContainer @label='Status' @tag='label' @vertical={{true}}>
              <@fields.status />
            </FieldContainer>
            <FieldContainer @label='Priority' @tag='label' @vertical={{true}}>
              <@fields.priority />
            </FieldContainer>
          </div>
        </section>

        <section class='edit-section'>
          <h2 class='section-heading'>Content</h2>
          <FieldContainer @label='Description' @tag='label' @vertical={{true}}>
            <div class='markdown-field-shell'>
              {{#unless @model.description}}
                <p class='empty-markdown-prompt'>
                  Add context, goals, constraints, or links to help define this
                  issue.
                </p>
              {{/unless}}
              <@fields.description />
            </div>
          </FieldContainer>
          <FieldContainer
            @label='Acceptance Criteria'
            @tag='label'
            @vertical={{true}}
          >
            <@fields.acceptanceCriteria />
          </FieldContainer>
        </section>

        <section class='edit-section'>
          <h2 class='section-heading'>Relations</h2>
          <FieldContainer @label='Project' @vertical={{true}}>
            <@fields.project />
          </FieldContainer>
          <FieldContainer @label='Blocked By' @vertical={{true}}>
            <@fields.blockedBy />
          </FieldContainer>
          <FieldContainer @label='Related Knowledge' @vertical={{true}}>
            <@fields.relatedKnowledge />
          </FieldContainer>
        </section>
      </div>
      <style scoped>
        .issue-edit {
          display: grid;
          gap: var(--boxel-sp-xl);
          padding: var(--boxel-sp-xl);
        }
        .edit-section {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          background: var(--card, var(--boxel-light));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius-lg);
        }
        .section-heading {
          margin: 0 0 var(--boxel-sp-2xs);
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-500));
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .field-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
        }
        .markdown-field-shell {
          display: grid;
          gap: var(--boxel-sp-xs);
        }
        .empty-markdown-prompt {
          margin: 0;
          font-size: 0.75rem;
          line-height: 1.4;
          color: var(--muted-foreground, var(--boxel-500));
        }
      </style>
    </template>
  };
}

class ProjectIsolated extends Component<typeof Project> {
  @tracked selectedCardIndex: number | null = null;
  @tracked showSettings = false;
  board: ProjectKanbanController;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.board = new ProjectKanbanController(
      () => this.args.model as Project,
      () => this.realmURL,
      issueCodeRef,
      this.args.createCard,
      this.args.viewCard,
      (index) => {
        this.selectedCardIndex = index;
      },
    );
  }

  get manager() {
    return this.board.manager;
  }

  get kanbanPlacements() {
    return this.board.kanbanPlacements;
  }

  get kanbanColumns() {
    return this.board.kanbanColumns;
  }

  get cardCount(): number {
    return this.board.cardCount;
  }

  get realmURL(): URL | undefined {
    return (this.args.model as any)[realmURL];
  }

  addCardToColumn = dropTask(async (columnKey: string | null | undefined) => {
    await this.board.addCardToColumn(columnKey);
  });

  get groupByOptions(): { displayName: string; sort: string }[] {
    return this.board.groupByOptions;
  }

  get selectedGroupByOption():
    | { displayName: string; sort: string }
    | undefined {
    return this.board.selectedGroupByOption;
  }

  onGroupByChange = (option: { displayName: string; sort: string }): void => {
    this.board.setGroupBy(option.sort);
  };

  get hideEmptyColumns(): boolean {
    return this.board.hideEmptyColumns;
  }

  toggleHideEmptyColumns = (): void => {
    this.board.toggleHideEmptyColumns();
  };

  // ── Settings ─────────────────────────────────────────────────────

  toggleSettings = (): void => {
    this.showSettings = !this.showSettings;
  };

  onColorChange = (key: string | null | undefined, event: Event): void => {
    this.board.setColumnColor(key, (event.target as HTMLInputElement).value);
  };

  onWipChange = (key: string | null | undefined, event: Event): void => {
    this.board.setColumnWipLimit(
      key,
      (event.target as HTMLInputElement).valueAsNumber,
    );
  };

  onCollapseChange = (key: string | null | undefined, event: Event): void => {
    this.board.setColumnCollapsed(
      key,
      (event.target as HTMLInputElement).checked,
    );
  };

  moveColUp = (key: string | null | undefined, _event: Event): void => {
    this.board.moveColUp(key);
  };

  moveColDown = (key: string | null | undefined, _event: Event): void => {
    this.board.moveColDown(key);
  };

  get statusColor() {
    return findOptionColor(
      projectStatusOptions,
      this.args.model.projectStatus ?? 'planning',
    );
  }

  // ── Template ─────────────────────────────────────────────────────

  <template>
    <div class='kanban-surface'>
      <ProjectKanbanToolbar
        @model={{@model}}
        @cardCount={{this.cardCount}}
        @hideEmptyColumns={{this.hideEmptyColumns}}
        @groupByOptions={{this.groupByOptions}}
        @selectedGroupByOption={{this.selectedGroupByOption}}
        @statusColor={{this.statusColor}}
        @onToggleHideEmptyColumns={{this.toggleHideEmptyColumns}}
        @onGroupByChange={{this.onGroupByChange}}
        @onToggleSettings={{this.toggleSettings}}
        @projectStatusField={{@fields.projectStatus}}
        @cardTitleField={{@fields.cardTitle}}
      />

      <div class='kanban-main'>
        <div class='kanban-body'>
          <KanbanPlane
            @columns={{this.kanbanColumns}}
            @placements={{this.kanbanPlacements}}
            @manager={{this.manager}}
            @interactive={{true}}
            @hideEmpty={{@model.hideEmptyColumns}}
            @onAddCard={{this.addCardToColumn.perform}}
          >
            <:card as |placement|>
              {{#let (get @fields.issues placement.index) as |CardField|}}
                {{#if CardField}}
                  <div class='kanban-card-wrap'>
                    <CardField @format='fitted' @displayContainer={{false}} />
                  </div>
                {{else}}
                  <div class='card-placeholder'>Card {{placement.index}}</div>
                {{/if}}
              {{/let}}
            </:card>
            <:ghost as |dragIdx|>
              {{#let (get @fields.issues dragIdx) as |CardField|}}
                {{#if CardField}}
                  <div class='ghost-wrap'>
                    <CardField @format='fitted' @displayContainer={{false}} />
                  </div>
                {{/if}}
              {{/let}}
            </:ghost>
          </KanbanPlane>
        </div>

        {{#if this.showSettings}}
          <ProjectKanbanSettingsPanel
            @columns={{this.kanbanColumns}}
            @onColorChange={{this.onColorChange}}
            @onWipChange={{this.onWipChange}}
            @onCollapseChange={{this.onCollapseChange}}
            @onMoveColUp={{this.moveColUp}}
            @onMoveColDown={{this.moveColDown}}
          />
        {{/if}}
      </div>
    </div>

    <style scoped>
      .kanban-surface {
        --kanban-surface-bg: var(--background, var(--boxel-200));
        --kanban-card-bg: var(--card, var(--boxel-light));
        --kanban-card-foreground: var(--card-foreground, var(--boxel-dark));
        --kanban-foreground: var(--foreground, var(--boxel-700));
        --kanban-muted-bg: var(--muted, var(--boxel-100));
        --kanban-muted-foreground: var(--muted-foreground, var(--boxel-500));
        --kanban-border-color: var(--border, var(--boxel-border-color));

        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 100%;
        background: var(--kanban-surface-bg);
        color: var(--kanban-foreground);
      }
      .kanban-main {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow: hidden;
      }
      .kanban-body {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .kanban-card-wrap {
        width: 100%;
        height: 100%;
        overflow: hidden;
        border-radius: inherit;
      }
      .ghost-wrap {
        width: 100%;
        height: 100%;
        overflow: hidden;
        border-radius: inherit;
      }
      .card-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        font-size: 0.75rem;
        color: var(--kanban-muted-foreground);
      }
    </style>
  </template>
}

export class Project extends CardDef {
  static displayName = 'Project';
  static prefersWideFormat = true;

  @field projectCode = contains(StringField);
  @field projectName = contains(StringField);
  @field projectStatus = contains(ProjectStatusField);
  @field objective = contains(TextAreaField);
  @field scope = contains(MarkdownField);
  @field technicalContext = contains(MarkdownField);
  @field issues = linksToMany(() => Issue, {
    query: {
      filter: {
        on: issueCodeRef,
        eq: { 'project.id': '$this.id' },
      },
    },
  });
  @field knowledgeBase = linksToMany(() => KnowledgeArticle);
  @field successCriteria = contains(MarkdownField);
  @field testArtifactsRealmUrl = contains(StringField);
  @field hideEmptyColumns = contains(BooleanField);
  @field groupBy = contains(GroupByField);
  @field issuePriorityOptions = containsMany(IssueOptionField);
  @field issueStatusOptions = containsMany(IssueOptionField);
  @field issueTypeOptions = containsMany(IssueOptionField);
  @field statusColumnConfig = containsMany(KanbanColumnField);
  @field priorityColumnConfig = containsMany(KanbanColumnField);
  @field typeColumnConfig = containsMany(KanbanColumnField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Project) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.projectName ?? 'Untitled Project');
    },
  });

  static fitted = class Fitted extends Component<typeof Project> {
    get statusColor(): string | undefined {
      return findOptionColor(
        projectStatusOptions,
        this.args.model?.projectStatus ?? 'planning',
      );
    }

    <template>
      <div class='project-card'>
        <div class='meta-row'>
          <span class='project-code'>{{if
              @model.projectCode
              @model.projectCode
              'PROJECT'
            }}</span>
          <StatusPill @color={{this.statusColor}}>
            {{#if @model.projectStatus}}
              <@fields.projectStatus @format='atom' />
            {{else}}
              Planning
            {{/if}}
          </StatusPill>
        </div>
        <p class='title'><@fields.cardTitle /></p>
      </div>
      <style scoped>
        .project-card {
          display: grid;
          grid-template-rows: auto 1fr;
          gap: var(--boxel-sp-2xs);
          padding: var(--boxel-sp-2xs) var(--boxel-sp-2xs) var(--boxel-sp-2xs)
            var(--boxel-sp);
          height: 100%;
          box-sizing: border-box;
        }
        .meta-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--boxel-sp-2xs);
        }
        .project-code {
          font-size: 0.6875rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-500));
          flex-shrink: 0;
        }
        .title {
          margin: 0;
          font-size: 0.8125rem;
          font-weight: 500;
          line-height: 1.4;
          color: var(--card-foreground, var(--boxel-dark));
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = ProjectIsolated;

  // ── Edit ───────────────────────────────────────────────────────────

  static edit = class Edit extends Component<typeof Project> {
    constructor(owner: Owner, args: any) {
      super(owner, args);
      Promise.resolve().then(() => {
        const model = this.args.model;
        if (!model) return;

        if (!model.issuePriorityOptions?.length) {
          model.issuePriorityOptions =
            buildIssueOptionFields(issuePriorityOptions);
        }
        if (!model.issueStatusOptions?.length) {
          model.issueStatusOptions = buildIssueOptionFields(issueStatusOptions);
        }
        if (!model.issueTypeOptions?.length) {
          model.issueTypeOptions = buildIssueOptionFields(issueTypeOptions);
        }
      });
    }

    <template>
      <div class='project-edit'>
        <section class='edit-section'>
          <h2 class='section-heading'>Project Info</h2>
          <div class='field-row'>
            <FieldContainer
              @label='Project Name'
              @tag='label'
              @vertical={{true}}
            >
              <@fields.projectName />
            </FieldContainer>
            <FieldContainer
              @label='Project Code'
              @tag='label'
              @vertical={{true}}
            >
              <@fields.projectCode />
            </FieldContainer>
          </div>
          <div class='field-row'>
            <FieldContainer @label='Status' @tag='label' @vertical={{true}}>
              <@fields.projectStatus />
            </FieldContainer>
            <FieldContainer @label='Theme' @tag='label' @vertical={{true}}>
              <@fields.cardInfo.theme />
            </FieldContainer>
          </div>
        </section>

        <section class='edit-section'>
          <h2 class='section-heading'>Board Settings</h2>
          <div class='field-row'>
            <FieldContainer @label='Group By' @tag='label' @vertical={{true}}>
              <@fields.groupBy />
            </FieldContainer>
            <FieldContainer
              @label='Hide Empty Columns'
              @tag='label'
              @vertical={{true}}
            >
              <@fields.hideEmptyColumns />
            </FieldContainer>
          </div>
        </section>

        <section class='edit-section'>
          <h2 class='section-heading'>Definition</h2>
          <FieldContainer @label='Objective' @tag='label' @vertical={{true}}>
            <@fields.objective />
          </FieldContainer>
          <FieldContainer @label='Scope' @tag='label' @vertical={{true}}>
            <@fields.scope />
          </FieldContainer>
          <FieldContainer
            @label='Technical Context'
            @tag='label'
            @vertical={{true}}
          >
            <@fields.technicalContext />
          </FieldContainer>
          <FieldContainer
            @label='Success Criteria'
            @tag='label'
            @vertical={{true}}
          >
            <@fields.successCriteria />
          </FieldContainer>
        </section>

        <section class='edit-section'>
          <h2 class='section-heading'>References</h2>
          <FieldContainer
            @label='Test Artifacts Realm URL'
            @tag='label'
            @vertical={{true}}
          >
            <@fields.testArtifactsRealmUrl />
          </FieldContainer>
          <FieldContainer @label='Knowledge Base' @vertical={{true}}>
            <@fields.knowledgeBase />
          </FieldContainer>
        </section>

        <section class='edit-section'>
          <div class='section-header'>
            <h2 class='section-heading'>Issue Configuration</h2>
            <p class='section-copy'>
              Define the status, priority, and type options that issues in this
              board can use.
            </p>
          </div>
          <div class='config-panels'>
            <div class='config-panel'>
              <FieldContainer @label='Status Options' @vertical={{true}}>
                <@fields.issueStatusOptions />
              </FieldContainer>
            </div>
            <div class='config-panel'>
              <FieldContainer @label='Priority Options' @vertical={{true}}>
                <@fields.issuePriorityOptions />
              </FieldContainer>
            </div>
            <div class='config-panel'>
              <FieldContainer @label='Type Options' @vertical={{true}}>
                <@fields.issueTypeOptions />
              </FieldContainer>
            </div>
          </div>
        </section>
      </div>
      <style scoped>
        .project-edit {
          display: grid;
          gap: var(--boxel-sp-xl);
          width: 100%;
          max-width: 72rem;
          margin: 0 auto;
          padding: var(--boxel-sp-xl);
          box-sizing: border-box;
        }
        .edit-section {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          background: var(--card, var(--boxel-light));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius-lg);
        }
        .section-heading {
          margin: 0 0 var(--boxel-sp-2xs);
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-500));
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .field-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
          min-width: 0;
        }
        .section-header {
          display: grid;
          gap: var(--boxel-sp-2xs);
        }
        .section-copy {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .config-panels {
          display: grid;
          gap: var(--boxel-sp);
        }
        .config-panel {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
          background: var(--sidebar, var(--background));
          color: var(--sidebar-foreground, var(--foreground));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius);
          box-shadow: inset 0 1px 0
            color-mix(in oklch, var(--card) 35%, transparent);
        }
      </style>
    </template>
  };
}

export class DarkFactory extends CardDef {
  static displayName = 'Dark Factory';

  @field factoryName = contains(StringField);
  @field description = contains(MarkdownField);
  @field activeProjects = linksToMany(() => Project);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: DarkFactory) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.factoryName ?? 'Dark Factory');
    },
  });

  static fitted = class Fitted extends Component<typeof DarkFactory> {
    <template>
      <div class='compact'>
        <strong><@fields.cardTitle /></strong>
      </div>
      <style scoped>
        .compact {
          padding: 0.75rem;
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof DarkFactory> {
    <template>
      <article class='surface'>
        <h1><@fields.cardTitle /></h1>
        {{#if @model.description}}
          <section>
            <h2>Description</h2>
            <@fields.description />
          </section>
        {{/if}}
        {{#if @model.activeProjects.length}}
          <section>
            <h2>Active Projects</h2>
            <@fields.activeProjects />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .surface {
          padding: 1.5rem;
          display: grid;
          gap: 1rem;
        }
      </style>
    </template>
  };
}
