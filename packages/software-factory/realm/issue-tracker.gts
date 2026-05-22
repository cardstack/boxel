import { tracked } from '@glimmer/tracking';
import { get } from '@ember/helper';
import { TrackedArray, TrackedObject } from 'tracked-built-ins';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { scheduleOnce } from '@ember/runloop';
import { dropTask } from 'ember-concurrency';

import {
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  Component,
  Theme,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateTimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import NumberField from 'https://cardstack.com/base/number';

import {
  FieldContainer,
  KanbanColumnConfigSidebar,
  KanbanPlane,
  ContextButton,
  Pill,
  Switch,
  Tooltip,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import LayoutSidebarRightCollapse from '@cardstack/boxel-icons/layout-sidebar-right-collapse';
import LayoutSidebarRightExpand from '@cardstack/boxel-icons/layout-sidebar-right-expand';
import Settings from '@cardstack/boxel-icons/settings';
import SquareKanban from '@cardstack/boxel-icons/square-kanban';

import { realmURL, type ResolvedCodeRef } from '@cardstack/runtime-common';

import { KanbanBoard } from './kanban-board';
import { KanbanColumnField } from './kanban-column';
import { KanbanBoardPlacement } from './kanban-board-placement';
import {
  issueStatusOptions,
  projectStatusOptions,
  findOptionColor,
  buildIssueOptionFields,
  configuredIssueStatusOptions,
  IssueStatusField,
  IssueTypeField,
  IssuePriorityField,
  ProjectStatusField,
} from './kanban-config';
import { Comment } from './comment';
import { KnowledgeArticle } from './knowledge-article';
import { StatusPill } from './status-pill';
import { IssueOptionField } from './issue-option';

const issueCodeRef: ResolvedCodeRef = {
  // @ts-expect-error this is not a CJS file, import.meta is allowed
  module: new URL('./issue-tracker', import.meta.url).href,
  name: 'Issue',
};

// ── Issue ──────────────────────────────────────────────────────────────────
type IssueStatusProject = {
  issueStatusOptions?: IssueOptionField[];
};

type IssueStatusIssue = {
  project?: IssueStatusProject | null;
};

function getProjectIssueStatusOptions(
  project: IssueStatusProject | null | undefined,
) {
  return configuredIssueStatusOptions(project);
}

function getIssueStatusOption(
  issue: IssueStatusIssue | null | undefined,
  value: string | null | undefined,
) {
  if (!value) {
    return undefined;
  }

  return getProjectIssueStatusOptions(issue?.project).find(
    (option) => option.value === value,
  );
}

function getIssueStatusLabel(
  issue: IssueStatusIssue | null | undefined,
  value: string | null | undefined,
) {
  return getIssueStatusOption(issue, value)?.label ?? value ?? 'Backlog';
}

function getIssueStatusColor(
  issue: IssueStatusIssue | null | undefined,
  value: string | null | undefined,
) {
  return getIssueStatusOption(issue, value)?.color;
}

function buildColumnsFromStatusOptions(
  options: ReturnType<typeof getProjectIssueStatusOptions>,
) {
  return options.map((option) =>
    Object.assign(new KanbanColumnField(), {
      key: option.value,
      label: option.label,
      color: option.color ?? null,
      collapsed: false,
      wipLimit: 0,
    }),
  );
}

class IssueIsolated extends Component<typeof Issue> {
  @tracked showSidebar = true;

  get statusColor(): string | undefined {
    return getIssueStatusColor(this.args.model, this.args.model?.status);
  }

  get statusLabel(): string {
    return getIssueStatusLabel(this.args.model, this.args.model?.status);
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
            {{this.statusLabel}}
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
                    {{this.statusLabel}}
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
      return getIssueStatusColor(this.args.model, this.args.model?.status);
    }

    get statusLabel(): string {
      return getIssueStatusLabel(this.args.model, this.args.model?.status);
    }

    <template>
      <div class='issue-card'>
        <div class='meta-row'>
          <span class='issue-id' data-test-issue-id>{{if
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
          <StatusPill class='issue-status' @color={{this.statusColor}}>
            {{this.statusLabel}}
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
        .issue-status {
          margin-left: auto;
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

  static edit = class Edit extends Component<typeof Issue> {
    <template>
      <div class='issue-edit' data-test-issue-edit>
        <section class='edit-section'>
          <h2 class='section-heading'>Basic Info</h2>
          <FieldContainer
            @label='Summary'
            @tag='label'
            @vertical={{true}}
            data-test-summary-field
          >
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
            <FieldContainer
              @label='Status'
              @tag='label'
              @vertical={{true}}
              data-test-issue-edit-status
            >
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

  static isolated = IssueIsolated;
}

// ── Project ────────────────────────────────────────────────────────────────

export class Project extends CardDef {
  static displayName = 'Project';
  static prefersWideFormat = true;

  @field projectCode = contains(StringField);
  @field projectName = contains(StringField);
  @field projectStatus = contains(ProjectStatusField);
  @field objective = contains(MarkdownField);
  @field scope = contains(MarkdownField);
  @field technicalContext = contains(MarkdownField);
  @field issueStatusOptions = containsMany(IssueOptionField);
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

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Project) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.projectName ?? 'Untitled Project');
    },
  });

  @field cardTheme = linksTo(() => Theme, {
    computeVia: function (this: Project) {
      return this.cardInfo?.theme;
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
        <h3 class='title'><@fields.cardTitle /></h3>
        <p><@fields.objective /></p>
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
          font-size: var(--boxel-font-size);
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

  static edit = class Edit extends Component<typeof Project> {
    constructor(owner: Owner, args: any) {
      super(owner, args);
      if (!this.args.model?.issueStatusOptions?.length) {
        scheduleOnce('actions', this, this.initDefaultIssueStatusOptions);
      }
    }

    initDefaultIssueStatusOptions() {
      if (!this.args.model?.issueStatusOptions?.length) {
        this.args.model.issueStatusOptions =
          buildIssueOptionFields(issueStatusOptions);
      }
    }

    <template>
      <div class='project-edit'>
        <div class='row'>
          <FieldContainer @label='Project Name' @vertical={{true}}>
            <@fields.projectName />
          </FieldContainer>
          <FieldContainer @label='Project Code' @vertical={{true}}>
            <@fields.projectCode />
          </FieldContainer>
        </div>
        <div class='row'>
          <FieldContainer @label='Status' @vertical={{true}}>
            <@fields.projectStatus />
          </FieldContainer>
        </div>
        {{!-- <div class='row'>
          <FieldContainer @label='Kanban Board' @vertical={{true}}>
            <@fields.kanbanBoards />
          </FieldContainer>
        </div> --}}
        <FieldContainer @label='Description' @vertical={{true}}>
          <@fields.objective />
        </FieldContainer>
        <div class='row'>
          <FieldContainer @label='Theme' @vertical={{true}}>
            <@fields.cardInfo.theme />
          </FieldContainer>
        </div>

        <section class='options-section'>
          <div class='options-section-header'>
            <h2 class='section-title'>Issue Configuration</h2>
            <p class='section-copy'>
              Define the status options that issues in this project can use.
            </p>
          </div>

          <div class='options-section-body'>
            <div class='options-config-panel'>
              <FieldContainer @label='Issue Status Options' @vertical={{true}}>
                <@fields.issueStatusOptions />
              </FieldContainer>
            </div>
          </div>
        </section>
      </div>
      <style scoped>
        .project-edit {
          display: grid;
          gap: var(--boxel-sp-xl);
          padding: var(--boxel-sp-xl);
        }
        .row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
          min-width: 0;
        }
        .options-section {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          background: var(--card, var(--boxel-light));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius-lg);
        }
        .options-section-header {
          display: grid;
          gap: var(--boxel-sp-2xs);
        }
        .options-section-body {
          display: grid;
          gap: var(--boxel-sp);
        }
        .options-config-panel {
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
        .section-title {
          margin: 0;
          font-size: var(--boxel-font-size);
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .section-copy {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-600));
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Project> {
    get statusColor(): string | undefined {
      return findOptionColor(
        projectStatusOptions,
        this.args.model?.projectStatus ?? 'planning',
      );
    }

    <template>
      <div class='background-container'>
        <article class='surface'>
          <header class='project-header'>
            <div class='project-meta-top'>
              <Pill @size='extra-small'>
                {{#if @model.projectCode}}
                  <@fields.projectCode />
                {{else}}
                  PROJECT
                {{/if}}
              </Pill>
              <StatusPill @color={{this.statusColor}}>
                {{#if @model.projectStatus}}
                  <@fields.projectStatus @format='atom' />
                {{else}}
                  Planning
                {{/if}}
              </StatusPill>
            </div>
            <h1><@fields.cardTitle /></h1>
          </header>

          <section class='project-section'>
            <h2 class='section-label'>Objective</h2>
            <@fields.objective />
          </section>

          {{#if @model.issues.length}}
            <section class='project-section'>
              <h2 class='section-label'>Issues</h2>
              <@fields.issues />
            </section>
          {{/if}}
        </article>
      </div>
      <style scoped>
        .background-container {
          height: 100%;
          overflow-y: auto;
          background-color: var(--background);
          color: var(--foreground);
        }
        .surface {
          max-width: 60rem;
          margin: 0 auto;
          padding: var(--boxel-sp-xl);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xl);
        }
        .project-header {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
          padding-bottom: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border);
        }
        .project-meta-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        h1 {
          font-size: 1.5rem;
          font-weight: 700;
          line-height: 1.3;
          margin: 0;
          color: var(--foreground);
        }
        .project-section {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
        }
        .project-section :deep(p:first-child) {
          margin-top: 0;
        }
        .section-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-foreground);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 0;
          padding-bottom: var(--boxel-sp-xs);
          border-bottom: 1px solid var(--border);
        }
      </style>
    </template>
  };
}

// ── IssueTrackerIsolated ──────────────────────────────────────────────

class IssueTrackerIsolated extends Component<typeof IssueTracker> {
  @tracked isSidebarOpen = false;
  columns!: TrackedArray<KanbanColumnConfig>;

  constructor(owner: Owner, args: any) {
    super(owner, args);

    let stored = this.args.model.columns ?? [];
    let source = stored.length
      ? stored
      : buildColumnsFromStatusOptions(
          getProjectIssueStatusOptions(this.args.model?.project),
        );
    this.columns = new TrackedArray(
      source.map(
        (col) =>
          new TrackedObject({
            key: col.key ?? '',
            label: col.label ?? null,
            color: col.color ?? null,
            collapsed: col.collapsed ?? null,
            wipLimit: col.wipLimit ?? null,
          }) as unknown as KanbanColumnConfig,
      ),
    );
  }

  get statusColor(): string | undefined {
    return findOptionColor(
      projectStatusOptions,
      this.args.model?.project?.projectStatus,
    );
  }

  get cardCount(): number {
    return this.args.model?.cards?.length ?? 0;
  }

  get columnCardCounts(): number[] {
    return this.columns.map(
      (col) => this.placements.filter((p) => p.columnId === col.key).length,
    );
  }

  get hideEmpty(): boolean {
    let emptyCols = this.columns.filter(
      (_, i) => (this.columnCardCounts[i] ?? 0) === 0,
    );
    return emptyCols.length > 0 && emptyCols.every((col) => col.collapsed);
  }

  toggleHideEmptyColumns = (): void => {
    let next = !this.hideEmpty;
    this.columnCardCounts.forEach((count, i) => {
      let col = this.columns[i];
      if (col && count === 0) {
        col.collapsed = next;
      }
    });
    this.handleColumnsChange([...this.columns]);
  };

  handleToggleCollapsed = (col: KanbanColumnConfig | null): void => {
    if (!col) {
      return;
    }
    col.collapsed = !col.collapsed;
    this.handleColumnsChange([...this.columns]);
  };

  handleColumnsChange = (newColumns: KanbanColumnConfig[]): void => {
    this.args.model.columns = newColumns.map((cfg) =>
      Object.assign(new KanbanColumnField(), {
        key: cfg.key,
        label: cfg.label,
        color: cfg.color,
        collapsed: cfg.collapsed,
        wipLimit: cfg.wipLimit,
      }),
    );

    let project = this.args.model.project;
    if (project?.issueStatusOptions?.length) {
      project.issueStatusOptions = project.issueStatusOptions.map((opt) => {
        let col = newColumns.find((c) => c.key === opt.value);
        if (!col) return opt;
        return Object.assign(new IssueOptionField(), {
          value: opt.value,
          label: col.label ?? opt.label,
          color: col.color ?? opt.color,
        });
      });
    }
  };

  handleLabelChange = (col: KanbanColumnConfig | null, val: string): void => {
    if (!col) return;
    col.label = val;
    this.handleColumnsChange([...this.columns]);
  };

  handleColorChange = (col: KanbanColumnConfig | null, val: string): void => {
    if (!col) return;
    col.color = val;
    this.handleColumnsChange([...this.columns]);
  };

  handleWipLimitChange = (
    col: KanbanColumnConfig | null,
    val: string,
  ): void => {
    if (!col) return;
    let raw = parseInt(val, 10);
    col.wipLimit = isNaN(raw) || raw < 0 ? 0 : raw;
    this.handleColumnsChange([...this.columns]);
  };

  handleReorder = (): void => {
    this.handleColumnsChange([...this.columns]);
  };

  toggleSidebar = (): void => {
    this.isSidebarOpen = !this.isSidebarOpen;
  };

  openCard = (index: number): void => {
    let card = this.args.model.cards?.[index];
    if (card) {
      this.args.viewCard?.(card, 'isolated');
    }
  };

  addCardTask = dropTask(async (columnKey: string | null) => {
    if (!columnKey) return;
    let model = this.args.model as any;
    let boardRealmURL: URL | undefined = model[realmURL];
    let projectId: string | null = model.project?.id ?? null;
    let cardId = await this.args.createCard?.(
      issueCodeRef,
      new URL(issueCodeRef.module),
      {
        realmURL: boardRealmURL,
        doc: {
          data: {
            type: 'card',
            attributes: { status: columnKey },
            relationships: projectId
              ? { project: { links: { self: projectId } } }
              : {},
            meta: { adoptsFrom: issueCodeRef },
          },
        },
      },
    );
    if (cardId) {
      let existing = this.args.model.placements ?? [];
      let nextOrder = existing.length
        ? Math.max(...existing.map((p) => p.sortOrder ?? 0)) + 1
        : 0;
      this.args.model.placements = [
        ...existing,
        Object.assign(new KanbanBoardPlacement(), {
          itemId: cardId,
          columnKey,
          sortOrder: nextOrder,
        }),
      ];
    }
  });

  handleChange = (newPlacements: KanbanPlacement[]) => {
    let cards = this.args.model?.cards ?? [];
    this.args.model.placements = newPlacements.map((p) => {
      let card = cards[p.index] as any;
      if (card && card.status !== p.columnId) {
        card.status = p.columnId;
      }
      return Object.assign(new KanbanBoardPlacement(), {
        itemId: card?.id ?? '',
        columnKey: p.columnId,
        sortOrder: p.sortOrder,
      });
    });
  };

  get placements(): KanbanPlacement[] {
    let stored = this.args.model?.placements;
    let cards = this.args.model?.cards ?? [];
    if (stored?.length) {
      let placedCardIds = new Set(stored.map((p) => p.itemId));
      let resolved = stored
        .map((p) => {
          let cardIdx = cards.findIndex((c) => (c as any).id === p.itemId);
          if (cardIdx === -1) return null;
          let card = cards[cardIdx] as any;
          let effectiveKey = card?.status ?? p.columnKey;
          let colKey =
            this.columns.find((c) => c.key === effectiveKey)?.key ??
            this.columns.find((c) => c.key === p.columnKey)?.key;
          if (!colKey) return null;
          return {
            columnId: colKey,
            index: cardIdx,
            sortOrder: p.sortOrder ?? 0,
          };
        })
        .filter((p): p is KanbanPlacement => p !== null);
      let maxOrder = resolved.length
        ? Math.max(...resolved.map((p) => p.sortOrder))
        : -1;
      let unplaced = cards
        .map((card, idx) => ({ card, idx }))
        .filter(({ card }) => !placedCardIds.has((card as any).id))
        .map(({ card, idx }, i) => {
          let status = (card as any).status ?? 'backlog';
          let colKey =
            this.columns.find((c) => c.key === status)?.key ??
            this.columns[0]?.key;
          return {
            columnId: colKey ?? '',
            index: idx,
            sortOrder: maxOrder + 1 + i,
          };
        });
      return [...resolved, ...unplaced];
    }
    return cards.map((card, idx) => {
      let status = (card as any).status ?? 'backlog';
      let colKey =
        this.columns.find((c) => c.key === status)?.key ?? this.columns[0]?.key;
      return {
        columnId: colKey ?? '',
        index: idx,
        sortOrder: idx,
      };
    });
  }

  <template>
    <div class='kanban-board-isolated'>
      <header class='kanban-toolbar'>
        <div class='toolbar-left'>
          <div class='kanban-heading'>
            <h2 class='kanban-title'>
              <SquareKanban />
              <@fields.cardTitle />
            </h2>
            {{#if @model.project}}
              <div class='kanban-project' data-test-issue-tracker-project-link>
                <span class='kanban-project-label'>Project</span>
                <@fields.project @format='atom' />
              </div>
            {{/if}}
          </div>
          <div>
            <span class='kanban-card-count' data-test-issue-tracker-card-count>
              {{#if (eq this.cardCount 1)}}
                1 card
              {{else}}
                {{this.cardCount}}
                cards
              {{/if}}
            </span>
          </div>
        </div>
        <div class='toolbar-right'>
          <div class='kanban-column-visibility-toggle'>
            <span class='kanban-header-label'>Hide empty</span>
            <Switch
              @isEnabled={{this.hideEmpty}}
              @onChange={{this.toggleHideEmptyColumns}}
              @label='Hide empty columns'
              data-test-hide-empty-switch
            />
          </div>
          <Tooltip @placement='bottom'>
            <:trigger>
              <ContextButton
                class='configure-btn'
                @icon={{Settings}}
                @label={{if
                  this.isSidebarOpen
                  'Close config sidebar'
                  'Open config sidebar'
                }}
                @variant='highlight'
                @isToggle={{true}}
                @isActive={{this.isSidebarOpen}}
                data-test-configure-columns-btn
                {{on 'click' this.toggleSidebar}}
              />
            </:trigger>
            <:content>{{if
                this.isSidebarOpen
                'Close config'
                'Configure columns'
              }}</:content>
          </Tooltip>
        </div>
      </header>
      <div class='kanban-body'>
        <div class='kanban-area'>
          <KanbanPlane
            @boardLabel={{@model.cardTitle}}
            @columns={{this.columns}}
            @placements={{this.placements}}
            @onChange={{this.handleChange}}
            @onOpen={{this.openCard}}
            @onAddCard={{this.addCardTask.perform}}
            @onToggleCollapsed={{this.handleToggleCollapsed}}
          >
            <:card as |placement|>
              {{#let (get @fields.cards placement.index) as |CardField|}}
                {{#if CardField}}
                  <div
                    class='kanban-card-wrap'
                    data-test-issue-tracker-card={{placement.index}}
                  >
                    <CardField @format='fitted' />
                  </div>
                {{/if}}
              {{/let}}
            </:card>
            <:ghost as |dragIdx|>
              {{#let (get @fields.cards dragIdx) as |CardField|}}
                {{#if CardField}}
                  <div class='kanban-card-wrap'>
                    <CardField @format='fitted' />
                  </div>
                {{/if}}
              {{/let}}
            </:ghost>
          </KanbanPlane>
        </div>

        <div
          class={{cn 'kanban-config-sidebar-wrap' is-open=this.isSidebarOpen}}
        >
          <KanbanColumnConfigSidebar
            @columns={{this.columns}}
            @onClose={{this.toggleSidebar}}
            @onToggleCollapsed={{this.handleToggleCollapsed}}
            @onLabelChange={{this.handleLabelChange}}
            @onColorChange={{this.handleColorChange}}
            @onWipLimitChange={{this.handleWipLimitChange}}
            @onReorder={{this.handleReorder}}
          />
        </div>
      </div>
    </div>
    <style scoped>
      .kanban-board-isolated {
        --board-bg: var(--background, var(--boxel-100));
        --board-fg: var(--foreground, var(--boxel-700));
        --board-card-bg: var(--card, var(--boxel-light));
        --board-card-fg: var(--foreground, var(--boxel-dark));
        --board-muted-bg: var(--muted, var(--boxel-100));
        --board-muted-fg: var(--muted-foreground, var(--boxel-500));
        --board-border: var(--border, var(--boxel-border-color));

        /* setting boxel-ui component variables */
        --boxel-kanban-bg: var(--board-bg);
        --boxel-kanban-fg: var(--board-fg);
        --boxel-kanban-card-bg: var(--board-card-bg);
        --boxel-kanban-card-fg: var(--board-card-fg);
        --boxel-kanban-muted-fg: var(--board-muted-fg);
        --boxel-kanban-border: var(--board-border);

        height: 100%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        background-color: var(--board-bg);
        color: var(--board-fg);
      }
      .kanban-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.625rem 1rem;
        border-bottom: 1px solid var(--board-border);
        background: var(--board-card-bg);
        color: var(--board-card-fg);
        flex-shrink: 0;
      }
      .toolbar-left {
        display: flex;
        gap: 0.5rem;
      }
      .kanban-heading {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .toolbar-right {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        color: var(--board-muted-fg);
      }
      .kanban-title {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: var(--boxel-font-size);
        font-weight: 600;
        margin: 0;
        letter-spacing: -0.01em;
      }
      .kanban-card-count {
        font-size: 0.75rem;
        color: var(--board-muted-fg);
        padding: 0.125rem 0.5rem;
        background: var(--board-muted-bg);
        border-radius: 4px;
      }
      .kanban-project {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .kanban-project-label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--board-muted-fg);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .kanban-column-visibility-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .kanban-header-label {
        font-size: 0.75rem;
        color: var(--board-muted-fg);
        white-space: nowrap;
      }
      .kanban-body {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow: hidden;
      }
      .kanban-area {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }
      .kanban-card-wrap {
        width: 100%;
        height: 100%;
        overflow: hidden;
        border-radius: inherit;
      }
      .kanban-config-sidebar-wrap {
        flex-shrink: 0;
        width: 0;
        overflow: hidden;
        transition: width var(--boxel-transition);
      }
      .kanban-config-sidebar-wrap.is-open {
        width: 19rem;
      }
    </style>
  </template>
}

// ── IssueTracker ──────────────────────────────────────────────────────

export class IssueTracker extends KanbanBoard {
  static displayName = 'Issue Tracker Board';

  @field project = linksTo(() => Project);
  @field cards = linksToMany(() => Issue, {
    computeVia: function (this: IssueTracker) {
      return this.project?.issues;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: IssueTracker) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.boardTitle ?? this.project?.cardTitle ?? 'Issue Tracker Board');
    },
  });

  static isolated = IssueTrackerIsolated;
}
