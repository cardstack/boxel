import { tracked } from '@glimmer/tracking';
import { get } from '@ember/helper';
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
  Accordion,
  BoxelSelect,
  FieldContainer,
  FittedCard,
  KanbanColumnConfigSidebar,
  KanbanPlane,
  ContextButton,
  Switch,
  Tooltip,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import BookOpen from '@cardstack/boxel-icons/book-open';
import CheckboxIcon from '@cardstack/boxel-icons/checkbox';
import CircleAlert from '@cardstack/boxel-icons/circle-alert';
import Folder from '@cardstack/boxel-icons/folder';
import LayoutSidebarRightCollapse from '@cardstack/boxel-icons/layout-sidebar-right-collapse';
import LayoutSidebarRightExpand from '@cardstack/boxel-icons/layout-sidebar-right-expand';
import MessageSquare from '@cardstack/boxel-icons/message-square';
import Settings from '@cardstack/boxel-icons/settings';
import SquareKanban from '@cardstack/boxel-icons/square-kanban';

import { realmURL, type ResolvedCodeRef } from '@cardstack/runtime-common';

import { KanbanBoard } from './kanban-board';
import { KanbanColumnField } from './kanban-column';
import { KanbanBoardPlacement } from './kanban-board-placement';
import {
  issueStatusOptions,
  issuePriorityOptions,
  issueTypeOptions,
  projectStatusOptions,
  defaultColumns,
  findOptionColor,
  buildIssueOptionFields,
  configuredIssueStatusOptions,
  IssueStatusField,
  IssueTypeField,
  IssuePriorityField,
  ProjectStatusField,
  GroupByField,
  type Column,
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

class IssueIsolated extends Component<typeof Issue> {
  @tracked showSidebar = true;
  @tracked descriptionOpen = true;
  @tracked acceptanceCriteriaOpen = true;
  @tracked commentsOpen = true;

  get statusColor(): string | undefined {
    return getIssueStatusColor(this.args.model, this.args.model?.status);
  }

  get statusLabel(): string {
    return getIssueStatusLabel(this.args.model, this.args.model?.status);
  }

  toggleSidebar = () => {
    this.showSidebar = !this.showSidebar;
  };

  toggleDescription = () => {
    this.descriptionOpen = !this.descriptionOpen;
  };

  toggleAcceptanceCriteria = () => {
    this.acceptanceCriteriaOpen = !this.acceptanceCriteriaOpen;
  };

  toggleComments = () => {
    this.commentsOpen = !this.commentsOpen;
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
            @isToggle={{true}}
            @isActive={{this.showSidebar}}
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
          <Accordion
            class='content-accordion'
            @displayContainer={{false}}
            as |A|
          >
            <A.Item
              @id='description'
              @isOpen={{this.descriptionOpen}}
              @onClick={{this.toggleDescription}}
            >
              <:title>Description</:title>
              <:content>
                <div class='section-body'>
                  {{#if @model.description}}
                    <@fields.description />
                  {{else}}
                    <p class='empty-section-text'>
                      No description yet. Add context, goals, constraints, or
                      links in edit mode.
                    </p>
                  {{/if}}
                </div>
              </:content>
            </A.Item>
            {{#if @model.acceptanceCriteria}}
              <A.Item
                @id='acceptance-criteria'
                @isOpen={{this.acceptanceCriteriaOpen}}
                @onClick={{this.toggleAcceptanceCriteria}}
              >
                <:title>Acceptance Criteria</:title>
                <:content>
                  <div class='section-body'>
                    <@fields.acceptanceCriteria />
                  </div>
                </:content>
              </A.Item>
            {{/if}}
            {{#if @model.comments.length}}
              <A.Item
                @id='comments'
                @isOpen={{this.commentsOpen}}
                @onClick={{this.toggleComments}}
              >
                <:title>
                  Comments
                  <span class='count-badge'>{{@model.comments.length}}</span>
                </:title>
                <:content>
                  <div class='comments-list'>
                    <@fields.comments @displayContainer={{false}} />
                  </div>
                </:content>
              </A.Item>
            {{/if}}
          </Accordion>
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
        container-type: inline-size;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
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
        overflow-y: auto;
      }
      .content-accordion {
        --boxel-accordion-title-font-size: 0.8125rem;
        --boxel-accordion-title-font-weight: 600;
        --boxel-accordion-trigger-padding-inline: var(--boxel-sp);
        --boxel-accordion-trigger-padding-block: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .content-accordion :deep(.boxel-accordion-item-trigger) {
        background: var(--muted, var(--boxel-100));
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
        padding: var(--boxel-sp);
        font-size: 0.875rem;
        line-height: 1.6;
        color: var(--foreground, var(--boxel-dark));
        max-width: 72ch;
        overflow-wrap: break-word;
        word-break: break-word;
      }
      .comments-list {
        padding: var(--boxel-sp);
      }
      .section-body :deep(img),
      .section-body :deep(video) {
        max-width: 100%;
        height: auto;
      }
      .section-body :deep(pre) {
        max-width: 100%;
        overflow-x: auto;
      }
      .section-body :deep(table) {
        max-width: 100%;
        display: block;
        overflow-x: auto;
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
        gap: 0;
      }
      .comments-list :deep(.comment) {
        padding: var(--boxel-sp-sm) 0;
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
      }
      .comments-list :deep(.comment:last-child) {
        border-bottom: none;
        padding-bottom: 0;
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
        background: var(--sidebar, var(--card, var(--boxel-50)));
        color: var(
          --sidebar-foreground,
          var(--card-foreground, var(--boxel-dark))
        );
        display: grid;
        gap: var(--boxel-sp-lg);
        align-content: start;
        overflow-y: auto;
        overflow-x: hidden;
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

      /* ── Narrow viewport (< 640px): stack sidebar below main, no toggle ── */
      @container (width < 640px) {
        .issue-header {
          padding: var(--boxel-sp) var(--boxel-sp) var(--boxel-sp-sm);
        }
        .issue-title {
          font-size: 1.125rem;
        }
        .sidebar-toggle {
          display: none;
        }
        .issue-body {
          flex-direction: column;
          overflow-y: auto;
        }
        .issue-main {
          overflow-y: visible;
        }
        .issue-sidebar {
          width: 100%;
          border-left: none;
          border-top: 1px solid var(--border, var(--boxel-border-color));
        }
        /* Override the wide-layout closed state — toggle is hidden here so the
           sidebar must always be reachable regardless of prior collapsed state. */
        .issue-body[data-sidebar='closed'] .issue-sidebar {
          width: 100%;
          border-left-width: 0;
        }
        .issue-sidebar-inner {
          width: 100%;
          overflow-y: visible;
          height: auto;
        }
      }

      /* ── Very narrow (< 420px) ── */
      @container (width < 420px) {
        .issue-header {
          padding: var(--boxel-sp-sm) var(--boxel-sp-sm) var(--boxel-sp-xs);
          gap: var(--boxel-sp-xs);
        }
        .issue-title {
          font-size: 1rem;
        }
        .meta-item {
          grid-template-columns: 4.5rem 1fr;
        }
      }
    </style>
  </template>
}

class IssueEdit extends Component<typeof Issue> {
  @tracked contentOpen = true;
  @tracked commentsOpen = true;
  @tracked relationsOpen = true;

  toggleContent = () => {
    this.contentOpen = !this.contentOpen;
  };
  toggleComments = () => {
    this.commentsOpen = !this.commentsOpen;
  };
  toggleRelations = () => {
    this.relationsOpen = !this.relationsOpen;
  };

  <template>
    <div class='issue-edit' data-test-issue-edit>
      <div class='edit-section-body edit-basic-info'>
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
        <FieldContainer @label='Project' @vertical={{true}}>
          <@fields.project />
        </FieldContainer>
      </div>

      <Accordion class='edit-accordion' @displayContainer={{false}} as |A|>
        <A.Item
          @id='content'
          @isOpen={{this.contentOpen}}
          @onClick={{this.toggleContent}}
        >
          <:title>Content</:title>
          <:content>
            <div class='edit-section-body'>
              <FieldContainer
                @label='Description'
                @tag='label'
                @vertical={{true}}
              >
                <div class='markdown-field-shell'>
                  {{#unless @model.description}}
                    <p class='empty-markdown-prompt'>
                      Add context, goals, constraints, or links to help define
                      this issue.
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
                <div class='markdown-field-shell'>
                  {{#unless @model.acceptanceCriteria}}
                    <p class='empty-markdown-prompt'>
                      Define the conditions that must be met for this issue to
                      be considered complete.
                    </p>
                  {{/unless}}
                  <@fields.acceptanceCriteria />
                </div>
              </FieldContainer>
            </div>
          </:content>
        </A.Item>

        <A.Item
          @id='comments'
          @isOpen={{this.commentsOpen}}
          @onClick={{this.toggleComments}}
        >
          <:title>Comments</:title>
          <:content>
            <div class='edit-section-body'>
              <@fields.comments />
            </div>
          </:content>
        </A.Item>

        <A.Item
          @id='relations'
          @isOpen={{this.relationsOpen}}
          @onClick={{this.toggleRelations}}
        >
          <:title>Relations</:title>
          <:content>
            <div class='edit-section-body'>
              <FieldContainer @label='Blocked By' @vertical={{true}}>
                <@fields.blockedBy />
              </FieldContainer>
              <FieldContainer @label='Related Knowledge' @vertical={{true}}>
                <@fields.relatedKnowledge />
              </FieldContainer>
            </div>
          </:content>
        </A.Item>
      </Accordion>
    </div>
    <style scoped>
      .issue-edit {
        container-type: inline-size;
      }
      .edit-accordion {
        --boxel-accordion-title-font-size: 0.8125rem;
        --boxel-accordion-title-font-weight: 600;
        --boxel-accordion-trigger-padding-inline: var(--boxel-sp);
        --boxel-accordion-trigger-padding-block: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .edit-accordion :deep(.boxel-accordion-item-trigger) {
        background: var(--muted, var(--boxel-100));
      }
      .edit-section-body {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
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

      @container (width < 480px) {
        .edit-section-body {
          padding: var(--boxel-sp);
        }
        .field-row {
          grid-template-columns: 1fr;
          gap: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

export class Issue extends CardDef {
  static displayName = 'Issue';
  static icon = CheckboxIcon;

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
      let cardTitle = this.cardInfo.name?.trim() ?? this.summary?.trim();
      return cardTitle ?? 'Untitled Issue';
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
      <FittedCard class='issue-fitted' @titleTag='h3'>
        <:badgeRight>
          <StatusPill class='status-badge-right' @color={{this.statusColor}}>
            {{this.statusLabel}}
          </StatusPill>
        </:badgeRight>
        <:eyebrow><div class='issue-id'><CheckboxIcon
              width='16'
              height='16'
              aria-hidden='true'
            /><span data-test-issue-id>{{if
                @model.issueId
                @model.issueId
                'ISSUE'
              }}</span></div></:eyebrow>
        <:title><@fields.cardTitle /></:title>
        <:subtitle>{{#if @model.issueType}}<@fields.issueType
              @format='atom'
            />{{/if}}</:subtitle>
        <:meta>
          <div class='meta-links'>
            {{#if @model.project}}
              <div class='meta-project'>
                <Folder class='meta-link-icon meta-project-icon' />
                <span
                  class='meta-project-name'
                >{{@model.project.cardTitle}}</span>
              </div>
            {{/if}}
            {{#if @model.blockedBy.length}}
              <div class='meta-link-item meta-blocked-by'>
                <CircleAlert class='meta-link-icon' />
                <span>Blocked by {{@model.blockedBy.length}}</span>
              </div>
            {{/if}}
            {{#if @model.relatedKnowledge.length}}
              <div class='meta-link-item meta-knowledge-article'>
                <BookOpen class='meta-link-icon' />
                <span>{{@model.relatedKnowledge.length}}
                  related</span>
              </div>
            {{/if}}
          </div>
        </:meta>
        <:footer>
          {{#if @model.priority}}
            <span class='priority' data-priority={{@model.priority}}>
              <@fields.priority @format='atom' />
            </span>
          {{/if}}
          <StatusPill class='status-pill' @color={{this.statusColor}}>
            {{this.statusLabel}}
          </StatusPill>
          {{#if @model.comments.length}}
            <span class='comment-count'>
              <MessageSquare class='comment-icon' />{{@model.comments.length}}
            </span>
          {{/if}}
        </:footer>
      </FittedCard>
      <style scoped>
        .issue-fitted {
          --boxel-heading-font-weight: 500;
          --fc-subtitle-line-clamp: 1;
          --fc-badge-right-display: none;
        }
        .status-badge-right {
          font-size: 0.6875rem;
        }
        @container fitted-card (1.0 < aspect-ratio) and (width >= 150px) and (height <= 105px) {
          .issue-fitted {
            --fc-badge-right-display: block;
            --fc-badge-offset: -1px;
          }
          .status-badge-right {
            border-bottom-right-radius: 0;
            border-top-right-radius: 0;
            border-top-left-radius: 0;
          }
        }
        /* Large badge */
        @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height >= 105px) {
          .issue-fitted {
            --fc-footer-display: none;
          }
        }
        .issue-id {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          font-size: 0.6875rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-500));
          flex-shrink: 0;
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
        .status-pill {
          margin-left: auto;
        }
        .comment-count {
          display: none;
          align-items: center;
          gap: 0.2em;
          font-size: 0.625rem;
          font-weight: 500;
          color: var(--muted-foreground, var(--boxel-500));
          flex-shrink: 0;
        }
        @container fitted-card (width >= 250px) {
          .comment-count {
            display: inline-flex;
          }
        }
        .comment-icon {
          width: 0.75rem;
          height: 0.75rem;
          flex-shrink: 0;
        }

        .meta-links {
          display: none;
          flex-direction: column;
          gap: var(--boxel-sp-2xs);
        }
        @container fitted-card ((width >= 150px) and (height >= 170px)) {
          .issue-fitted {
            --fc-meta-display: block;
            --fc-title-line-clamp: 3;
          }
          .meta-links {
            display: flex;
            width: 100%;
            max-width: 100%;
            padding-top: var(--boxel-sp-xs);
            border-top: 1px solid
              color-mix(
                in oklch,
                var(--border, var(--boxel-border-color)) 50%,
                transparent
              );
          }
        }
        .meta-project {
          display: flex;
          align-items: center;
          gap: 0.3em;
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
        }
        .meta-project-icon {
          color: var(--muted-foreground, var(--boxel-500));
          flex-shrink: 0;
        }
        .meta-project-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta-link-item {
          display: flex;
          align-items: center;
          gap: 0.3em;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-500));
          overflow: hidden;
        }
        .meta-link-icon {
          width: 0.75rem;
          height: 0.75rem;
          flex-shrink: 0;
        }
        /* Small Tile (150x170) */
        @container fitted-card (aspect-ratio <= 1.0) and (width <= 150px) and (height <= 170px) {
          .meta-project,
          .meta-knowledge-article {
            display: none;
          }
        }
        /* Compact Card (400x170) */
        @container fitted-card (1.0 < aspect-ratio) and (width >= 400px) and (170px <= height < 275px) {
          .meta-project,
          .meta-knowledge-article {
            display: none;
          }
        }
        /* Regular Tile (250x170) */
        @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (170px <= height < 220px) {
          .meta-project,
          .meta-knowledge-article {
            display: none;
          }
          .meta-links {
            border-top: none;
          }
        }
        /* Expanded Card (400x445, vertical) */
        @container fitted-card (aspect-ratio <= 1.0) and (width >= 400px) and (445px <= height) {
          .issue-fitted {
            --fc-header-gap: var(--boxel-sp-sm);
            --fc-title-line-clamp: 4;
            --fc-content-gap-no-image: var(--boxel-sp-lg);
          }
          .meta-links {
            gap: var(--boxel-sp-xs);
          }
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static edit = IssueEdit;
  static isolated = IssueIsolated;
}

// ── ProjectEdit ────────────────────────────────────────────────────────────

class ProjectEdit extends Component<typeof Project> {
  @tracked contentOpen = true;
  @tracked configOpen = true;

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

  toggleContent = () => {
    this.contentOpen = !this.contentOpen;
  };
  toggleConfig = () => {
    this.configOpen = !this.configOpen;
  };
  @tracked knowledgeBaseOpen = true;
  toggleKnowledgeBase = () => {
    this.knowledgeBaseOpen = !this.knowledgeBaseOpen;
  };

  <template>
    <div class='project-edit'>
      <div class='edit-section-body edit-identity'>
        <div class='field-row'>
          <FieldContainer @label='Project Name' @tag='label' @vertical={{true}}>
            <@fields.projectName />
          </FieldContainer>
          <FieldContainer @label='Project Code' @tag='label' @vertical={{true}}>
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
      </div>

      <Accordion class='edit-accordion' @displayContainer={{false}} as |A|>
        <A.Item
          @id='content'
          @isOpen={{this.contentOpen}}
          @onClick={{this.toggleContent}}
        >
          <:title>Content</:title>
          <:content>
            <div class='edit-section-body'>
              <FieldContainer
                @label='Objective'
                @tag='label'
                @vertical={{true}}
              >
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
            </div>
          </:content>
        </A.Item>

        <A.Item
          @id='knowledge-base'
          @isOpen={{this.knowledgeBaseOpen}}
          @onClick={{this.toggleKnowledgeBase}}
        >
          <:title>Knowledge Base</:title>
          <:content>
            <div class='edit-section-body'>
              <FieldContainer @label='Knowledge Base' @vertical={{true}}>
                <@fields.knowledgeBase />
              </FieldContainer>
            </div>
          </:content>
        </A.Item>

        <A.Item
          @id='config'
          @isOpen={{this.configOpen}}
          @onClick={{this.toggleConfig}}
        >
          <:title>Issue Configuration</:title>
          <:content>
            <div class='edit-section-body'>
              <p class='section-copy'>
                Define the status options that issues in this project can use.
              </p>
              <FieldContainer @label='Issue Status Options' @vertical={{true}}>
                <@fields.issueStatusOptions />
              </FieldContainer>
            </div>
          </:content>
        </A.Item>
      </Accordion>
    </div>
    <style scoped>
      .project-edit {
        container-type: inline-size;
      }
      .edit-accordion {
        --boxel-accordion-title-font-size: 0.8125rem;
        --boxel-accordion-title-font-weight: 600;
        --boxel-accordion-trigger-padding-inline: var(--boxel-sp);
        --boxel-accordion-trigger-padding-block: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .edit-accordion :deep(.boxel-accordion-item-trigger) {
        background: var(--muted, var(--boxel-100));
      }
      .edit-section-body {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
      }
      .field-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp);
      }
      .edit-identity :deep(.links-to-editor .field-component-card) {
        min-height: 2.5rem;
        max-height: 2.5rem;
        height: 2.5rem;
      }
      .section-copy {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        line-height: 1.5;
        color: var(--muted-foreground, var(--boxel-600));
      }
      @container (width < 480px) {
        .edit-section-body {
          padding: var(--boxel-sp);
        }
        .field-row {
          grid-template-columns: 1fr;
          gap: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

// ── ProjectIsolated ─────────────────────────────────────────────────────────

class ProjectIsolated extends Component<typeof Project> {
  @tracked showSidebar = true;
  @tracked objectiveOpen = true;
  @tracked scopeOpen = true;
  @tracked technicalOpen = true;
  @tracked criteriaOpen = true;
  @tracked issuesOpen = true;

  get statusColor(): string | undefined {
    return findOptionColor(
      projectStatusOptions,
      this.args.model?.projectStatus ?? 'planning',
    );
  }

  toggleSidebar = () => {
    this.showSidebar = !this.showSidebar;
  };
  toggleObjective = () => {
    this.objectiveOpen = !this.objectiveOpen;
  };
  toggleScope = () => {
    this.scopeOpen = !this.scopeOpen;
  };
  toggleTechnical = () => {
    this.technicalOpen = !this.technicalOpen;
  };
  toggleCriteria = () => {
    this.criteriaOpen = !this.criteriaOpen;
  };
  toggleIssues = () => {
    this.issuesOpen = !this.issuesOpen;
  };

  <template>
    <div class='project-isolated'>
      <header class='project-header'>
        <div class='header-chips'>
          <Folder class='project-icon' aria-hidden='true' />
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
          <ContextButton
            class='sidebar-toggle'
            @icon={{if
              this.showSidebar
              LayoutSidebarRightCollapse
              LayoutSidebarRightExpand
            }}
            @label={{if this.showSidebar 'Collapse sidebar' 'Expand sidebar'}}
            @variant='ghost'
            @isToggle={{true}}
            @isActive={{this.showSidebar}}
            {{on 'click' this.toggleSidebar}}
          />
        </div>
        <h1 class='project-title'><@fields.cardTitle /></h1>
      </header>

      <div
        class='project-body'
        data-sidebar={{if this.showSidebar 'open' 'closed'}}
      >
        <main class='project-main'>
          <Accordion
            class='content-accordion'
            @displayContainer={{false}}
            as |A|
          >
            <A.Item
              @id='objective'
              @isOpen={{this.objectiveOpen}}
              @onClick={{this.toggleObjective}}
            >
              <:title>Objective</:title>
              <:content>
                <div class='section-body'>
                  {{#if @model.objective}}
                    <@fields.objective />
                  {{else}}
                    <p class='empty-section-text'>
                      No objective defined yet. Add goals and context in edit
                      mode.
                    </p>
                  {{/if}}
                </div>
              </:content>
            </A.Item>
            {{#if @model.scope}}
              <A.Item
                @id='scope'
                @isOpen={{this.scopeOpen}}
                @onClick={{this.toggleScope}}
              >
                <:title>Scope</:title>
                <:content>
                  <div class='section-body'><@fields.scope /></div>
                </:content>
              </A.Item>
            {{/if}}
            {{#if @model.technicalContext}}
              <A.Item
                @id='technical'
                @isOpen={{this.technicalOpen}}
                @onClick={{this.toggleTechnical}}
              >
                <:title>Technical Context</:title>
                <:content>
                  <div class='section-body'><@fields.technicalContext /></div>
                </:content>
              </A.Item>
            {{/if}}
            {{#if @model.successCriteria}}
              <A.Item
                @id='criteria'
                @isOpen={{this.criteriaOpen}}
                @onClick={{this.toggleCriteria}}
              >
                <:title>Success Criteria</:title>
                <:content>
                  <div class='section-body'><@fields.successCriteria /></div>
                </:content>
              </A.Item>
            {{/if}}
            {{#if @model.issues.length}}
              <A.Item
                @id='issues'
                @isOpen={{this.issuesOpen}}
                @onClick={{this.toggleIssues}}
              >
                <:title>
                  Issues
                  <span class='count-badge'>{{@model.issues.length}}</span>
                </:title>
                <:content>
                  <div class='issues-list'>
                    <@fields.issues />
                  </div>
                </:content>
              </A.Item>
            {{/if}}
          </Accordion>
        </main>

        <aside class='project-sidebar'>
          <div class='project-sidebar-inner'>
            <dl class='meta-list'>
              <div class='meta-item'>
                <dt>Status</dt>
                <dd>
                  <StatusPill @color={{this.statusColor}}>
                    {{#if @model.projectStatus}}
                      <@fields.projectStatus @format='atom' />
                    {{else}}
                      Planning
                    {{/if}}
                  </StatusPill>
                </dd>
              </div>
              {{#if @model.issues.length}}
                <div class='meta-item'>
                  <dt>Issues</dt>
                  <dd class='stat-value'>
                    <CheckboxIcon
                      class='stat-icon'
                      width='14'
                      height='14'
                      aria-hidden='true'
                    />
                    {{@model.issues.length}}
                  </dd>
                </div>
              {{/if}}
              {{#if @model.knowledgeBase.length}}
                <div class='meta-item'>
                  <dt>Knowledge</dt>
                  <dd class='stat-value'>
                    <BookOpen
                      class='stat-icon'
                      width='14'
                      height='14'
                      aria-hidden='true'
                    />
                    {{@model.knowledgeBase.length}}
                  </dd>
                </div>
              {{/if}}
            </dl>

            {{#if @model.knowledgeBase.length}}
              <div class='sidebar-section'>
                <h3 class='sidebar-section-title'>Knowledge Base</h3>
                <div class='related-list'>
                  <@fields.knowledgeBase />
                </div>
              </div>
            {{/if}}
          </div>
        </aside>
      </div>
    </div>
    <style scoped>
      .project-isolated {
        container-type: inline-size;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        display: flex;
        flex-direction: column;
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
      }
      .project-header {
        padding: var(--boxel-sp-xl) var(--boxel-sp-xl) var(--boxel-sp-lg);
        background: var(--muted, var(--boxel-100));
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
        display: grid;
        gap: var(--boxel-sp-2xs);
        flex-shrink: 0;
      }
      .header-chips {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        flex-wrap: wrap;
      }
      .project-icon {
        width: 1rem;
        height: 1rem;
        color: var(--muted-foreground, var(--boxel-500));
        flex-shrink: 0;
      }
      .project-code {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .sidebar-toggle {
        margin-left: auto;
        flex-shrink: 0;
      }
      .project-title {
        margin: 0;
        font-size: 1.375rem;
        font-weight: 600;
        line-height: 1.3;
        color: var(--foreground, var(--boxel-dark));
      }
      .project-body {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow: hidden;
      }
      .project-main {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
      }
      .content-accordion {
        --boxel-accordion-title-font-size: 0.8125rem;
        --boxel-accordion-title-font-weight: 600;
        --boxel-accordion-trigger-padding-inline: var(--boxel-sp);
        --boxel-accordion-trigger-padding-block: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .content-accordion :deep(.boxel-accordion-item-trigger) {
        background: var(--muted, var(--boxel-100));
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
        padding: var(--boxel-sp);
        font-size: 0.875rem;
        line-height: 1.6;
        color: var(--foreground, var(--boxel-dark));
        max-width: 72ch;
        overflow-wrap: break-word;
        word-break: break-word;
      }
      .section-body :deep(img),
      .section-body :deep(video) {
        max-width: 100%;
        height: auto;
      }
      .section-body :deep(pre) {
        max-width: 100%;
        overflow-x: auto;
      }
      .section-body :deep(table) {
        max-width: 100%;
        display: block;
        overflow-x: auto;
      }
      .section-body :deep(p:first-child) {
        margin-top: 0;
      }
      .empty-section-text {
        margin: 0;
        color: var(--muted-foreground, var(--boxel-500));
        background: color-mix(
          in oklch,
          var(--muted, var(--boxel-100)) 70%,
          transparent
        );
        border: 1px dashed var(--border, var(--boxel-border-color));
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
      }
      .issues-list {
        padding: var(--boxel-sp);
        display: grid;
        gap: var(--boxel-sp-2xs);
      }
      .project-sidebar {
        width: 18rem;
        flex-shrink: 0;
        overflow: hidden;
        border-left: 1px solid var(--border, var(--boxel-border-color));
        transition: width 0.25s ease;
      }
      .project-sidebar-inner {
        width: 18rem;
        padding: var(--boxel-sp-lg) var(--boxel-sp);
        background: var(--sidebar, var(--card, var(--boxel-50)));
        color: var(
          --sidebar-foreground,
          var(--card-foreground, var(--boxel-dark))
        );
        display: grid;
        gap: var(--boxel-sp-lg);
        align-content: start;
        overflow-y: auto;
        overflow-x: hidden;
        height: 100%;
        box-sizing: border-box;
      }
      .project-body[data-sidebar='closed'] .project-sidebar {
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
      .stat-value {
        display: flex;
        align-items: center;
        gap: 0.3em;
        font-size: 0.8125rem;
        font-weight: 500;
      }
      .stat-icon {
        color: var(--muted-foreground, var(--boxel-500));
        flex-shrink: 0;
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
      .related-list {
        display: grid;
        gap: var(--boxel-sp-2xs);
      }

      @container (width < 640px) {
        .project-header {
          padding: var(--boxel-sp) var(--boxel-sp) var(--boxel-sp-sm);
        }
        .project-title {
          font-size: 1.125rem;
        }
        .sidebar-toggle {
          display: none;
        }
        .project-body {
          flex-direction: column;
          overflow-y: auto;
        }
        .project-main {
          overflow-y: visible;
        }
        .project-sidebar {
          width: 100%;
          border-left: none;
          border-top: 1px solid var(--border, var(--boxel-border-color));
        }
        .project-body[data-sidebar='closed'] .project-sidebar {
          width: 100%;
          border-left-width: 0;
        }
        .project-sidebar-inner {
          width: 100%;
          overflow-y: visible;
          height: auto;
        }
      }

      @container (width < 420px) {
        .project-header {
          padding: var(--boxel-sp-sm) var(--boxel-sp-sm) var(--boxel-sp-xs);
          gap: var(--boxel-sp-xs);
        }
        .project-title {
          font-size: 1rem;
        }
        .meta-item {
          grid-template-columns: 4.5rem 1fr;
        }
      }
    </style>
  </template>
}

// ── Project ────────────────────────────────────────────────────────────────

export class Project extends CardDef {
  static displayName = 'Project';

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
      let cardTitle = this.cardInfo.name?.trim() ?? this.projectName?.trim();
      return cardTitle ?? 'Untitled Project';
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

    get issueCount(): number {
      return this.args.model?.issues?.length ?? 0;
    }

    get knowledgeCount(): number {
      return this.args.model?.knowledgeBase?.length ?? 0;
    }

    <template>
      <FittedCard
        class='project-fitted'
        @titleTag='h3'
        data-status={{@model.projectStatus}}
      >
        <:eyebrow>
          <div class='project-eyebrow'>
            <Folder width='14' height='14' aria-hidden='true' />
            <span>{{if @model.projectCode @model.projectCode 'PROJECT'}}</span>
          </div>
        </:eyebrow>
        <:title><@fields.cardTitle /></:title>
        <:meta>
          <div class='project-stats'>
            {{#if this.issueCount}}
              <span class='stat-item'>
                <CheckboxIcon
                  class='stat-icon'
                  width='16'
                  height='16'
                  aria-hidden='true'
                />{{this.issueCount}}
              </span>
            {{/if}}
            {{#if this.knowledgeCount}}
              <span class='stat-item'>
                <BookOpen
                  class='stat-icon'
                  width='16'
                  height='16'
                  aria-hidden='true'
                />{{this.knowledgeCount}}
              </span>
            {{/if}}
          </div>
        </:meta>
        <:badgeRight>
          <StatusPill class='status-badge-right' @color={{this.statusColor}}>
            {{#if @model.projectStatus}}
              <@fields.projectStatus @format='atom' />
            {{else}}
              Planning
            {{/if}}
          </StatusPill>
        </:badgeRight>
        <:footer>
          <StatusPill class='status-pill' @color={{this.statusColor}}>
            {{#if @model.projectStatus}}
              <@fields.projectStatus @format='atom' />
            {{else}}
              Planning
            {{/if}}
          </StatusPill>
        </:footer>
      </FittedCard>
      <style scoped>
        .project-fitted {
          --project-accent: var(--muted-foreground, var(--boxel-500));
          --fc-meta-display: none;
          --fc-badge-right-display: none;
          --boxel-heading-font-weight: 600;
          box-shadow: inset 3px 0 0 var(--project-accent);
        }
        .status-badge-right {
          font-size: 0.6875rem;
        }
        @container fitted-card (1.0 < aspect-ratio) and (width >= 150px) and (height <= 105px) {
          .project-fitted {
            --fc-badge-right-display: block;
            --fc-badge-offset: -1px;
          }
          .status-badge-right {
            border-bottom-right-radius: 0;
            border-top-right-radius: 0;
            border-top-left-radius: 0;
          }
        }
        /* Large badge */
        @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height >= 105px) {
          .project-fitted {
            --fc-footer-display: none;
          }
        }
        .project-fitted[data-status='planning'] {
          --project-accent: oklch(55% 0.24 264);
        }
        .project-fitted[data-status='active'] {
          --project-accent: oklch(48% 0.14 145);
        }
        .project-fitted[data-status='on_hold'] {
          --project-accent: oklch(72% 0.17 75);
        }
        .project-fitted[data-status='completed'] {
          --project-accent: oklch(52% 0.22 298);
        }
        .project-eyebrow {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          color: var(--project-accent);
          font-weight: 700;
        }
        .project-stats {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding-top: var(--boxel-sp-xs);
          border-top: 1px solid
            color-mix(
              in oklch,
              var(--border, var(--boxel-border-color)) 50%,
              transparent
            );
          font-weight: 500;
          width: 100%;
        }
        .stat-item {
          display: flex;
          align-items: center;
          gap: 0.25em;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .stat-icon {
          flex-shrink: 0;
        }
        @container fitted-card (1.0 < aspect-ratio) and (height < 65px) {
          .project-fitted {
            --fc-content-padding: var(--boxel-sp-2xs) var(--boxel-sp-2xs)
              var(--boxel-sp-2xs) var(--boxel-sp-xs);
          }
        }
        @container fitted-card (width >= 150px) and (170px >= height >= 65px) {
          .project-fitted {
            --fc-content-padding: var(--boxel-sp-2xs) var(--boxel-sp-2xs)
              var(--boxel-sp-2xs) var(--boxel-sp);
          }
        }
        @container fitted-card ((width >= 150px) and (height > 170px)) {
          .project-fitted {
            --fc-title-font-size: 1rem;
            --fc-content-padding: var(--boxel-sp);
          }
        }
        @container fitted-card ((width >= 150px) and (height >= 170px)) {
          .project-fitted {
            --fc-meta-display: flex;
            --fc-title-line-clamp: 3;
          }
        }
        @container fitted-card (1.0 < aspect-ratio) and (width >= 250px) and
          (105px <= height < 170px) {
          .project-fitted {
            --fc-meta-display: flex;
          }
          .project-stats {
            padding-top: 0;
            border-top: none;
          }
        }
        @container fitted-card ((width >= 400px) and (height >= 105px))) {
          .project-fitted {
            --fc-content-padding: var(--boxel-sp);
          }
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static edit = ProjectEdit;

  static isolated = ProjectIsolated;
}

// ── IssueTrackerIsolated ──────────────────────────────────────────────

class IssueTrackerIsolated extends Component<typeof IssueTracker> {
  @tracked isSidebarOpen = false;
  @tracked uncategorizedCollapsed = false;

  get activeGroupBy(): string {
    const stored = this.args.model.groupBy;
    return stored && defaultColumns.some((d) => d.key === stored)
      ? stored
      : 'status';
  }

  get groupByFieldName(): string {
    switch (this.activeGroupBy) {
      case 'priority':
        return 'priority';
      case 'issueType':
        return 'issueType';
      default:
        return 'status';
    }
  }

  get groupByDimensions(): Column[] {
    return defaultColumns;
  }

  get selectedGroupByDimension(): Column | undefined {
    return defaultColumns.find((d) => d.key === this.activeGroupBy);
  }

  updateGroupBy = (dim: Column): void => {
    this.args.model.groupBy = dim.key;
    this.args.model.columns = [];
    this.uncategorizedCollapsed = false;
  };

  get columns(): KanbanColumnConfig[] {
    let options =
      this.activeGroupBy === 'priority'
        ? issuePriorityOptions
        : this.activeGroupBy === 'issueType'
          ? issueTypeOptions
          : getProjectIssueStatusOptions(this.args.model?.project);

    let stored = this.args.model.columns ?? [];
    let optionKeys = new Set(options.map((o) => o.value));
    let storedMatchesCurrent =
      stored.length > 0 && stored.every((c) => optionKeys.has(c.key));

    let fieldName = this.groupByFieldName;
    let cards = this.args.model.cards ?? [];
    let hideEmpty = this.args.model.hideEmptyColumns ?? false;

    let baseColumns: KanbanColumnConfig[];
    if (storedMatchesCurrent) {
      baseColumns = stored.map((col) => ({
        key: col.key,
        label: col.label,
        color: col.color,
        collapsed: col.collapsed ?? false,
        wipLimit: col.wipLimit ?? null,
        sortOrder: col.sortOrder,
      }));
    } else {
      baseColumns = options.map((option, i) => {
        let isEmpty =
          hideEmpty &&
          !cards.some((c) => (c as any)[fieldName] === option.value);
        return {
          key: option.value,
          label: option.label,
          color: option.color ?? null,
          collapsed: isEmpty,
          wipLimit: 0,
          sortOrder: i + 1,
        };
      });
    }

    let fallbackKey = this.args.model.groupByFallbackKey;
    if (fallbackKey && optionKeys.has(fallbackKey)) return baseColumns;
    let hasOrphan = cards.some((card) => {
      let v = (card as any)[fieldName];
      return !v || !optionKeys.has(v);
    });

    if (!hasOrphan) return baseColumns;

    return [
      ...baseColumns,
      {
        key: 'uncategorized',
        label: 'Uncategorized',
        color: null,
        collapsed: this.uncategorizedCollapsed,
        wipLimit: null,
        sortOrder: baseColumns.length + 1,
      },
    ];
  }

  get statusColor(): string | undefined {
    return findOptionColor(
      projectStatusOptions,
      this.args.model?.project?.projectStatus,
    );
  }

  get configurableColumns(): KanbanColumnConfig[] {
    return this.columns.filter((c) => c.key !== 'uncategorized');
  }

  get firstColumn(): KanbanColumnConfig | undefined {
    return [...this.columns].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  }

  get cardCount(): number {
    return this.args.model?.cards?.length ?? 0;
  }

  get columnCardCounts(): number[] {
    return this.columns.map(
      (col: KanbanColumnConfig) =>
        this.placements.filter((p) => p.columnId === col.key).length,
    );
  }

  get columnCardCountsByKey(): Record<string, number> {
    let result: Record<string, number> = {};
    this.columns.forEach((col, i) => {
      result[col.key] = this.columnCardCounts[i] ?? 0;
    });
    return result;
  }

  get hideEmpty(): boolean {
    return this.args.model.hideEmptyColumns ?? false;
  }

  toggleHideEmpty = (): void => {
    return this.toggleHideEmptyColumns();
  };

  toggleHideEmptyColumns = (): void => {
    let next = !this.hideEmpty;
    this.args.model.hideEmptyColumns = next;
    this.handleColumnsChange(
      this.columns.map((col: KanbanColumnConfig, i: number) =>
        (this.columnCardCounts[i] ?? 0) === 0
          ? { ...col, collapsed: next }
          : col,
      ),
    );
  };

  handleToggleCollapsed = (col: KanbanColumnConfig | null): void => {
    if (!col) return;
    if (col.key === 'uncategorized') {
      this.uncategorizedCollapsed = !this.uncategorizedCollapsed;
      return;
    }
    this.handleColumnsChange(
      this.columns.map((c: KanbanColumnConfig) =>
        c.key === col.key ? { ...c, collapsed: !c.collapsed } : c,
      ),
    );
  };

  handleColumnsChange = (newColumns: KanbanColumnConfig[]): void => {
    this.args.model.columns = newColumns
      .filter((cfg) => cfg.key !== 'uncategorized')
      .map((cfg) =>
        Object.assign(new KanbanColumnField(), {
          key: cfg.key,
          label: cfg.label,
          color: cfg.color,
          collapsed: cfg.collapsed,
          wipLimit: cfg.wipLimit,
          sortOrder: cfg.sortOrder,
        }),
      );

    if (this.activeGroupBy === 'status') {
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
    }
  };

  handleLabelChange = (col: KanbanColumnConfig | null, val: string): void => {
    if (!col) return;
    this.handleColumnsChange(
      this.columns.map((c: KanbanColumnConfig) =>
        c.key === col.key ? { ...c, label: val } : c,
      ),
    );
  };

  handleColorChange = (col: KanbanColumnConfig | null, val: string): void => {
    if (!col) return;
    this.handleColumnsChange(
      this.columns.map((c: KanbanColumnConfig) =>
        c.key === col.key ? { ...c, color: val } : c,
      ),
    );
  };

  handleWipLimitChange = (
    col: KanbanColumnConfig | null,
    val: string,
  ): void => {
    if (!col) return;
    let raw = parseInt(val, 10);
    let wipLimit = isNaN(raw) || raw < 0 ? 0 : raw;
    this.handleColumnsChange(
      this.columns.map((c: KanbanColumnConfig) =>
        c.key === col.key ? { ...c, wipLimit } : c,
      ),
    );
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
    let fieldName = this.groupByFieldName;
    let fieldValue = columnKey !== 'uncategorized' ? columnKey : undefined;
    let cardId = await this.args.createCard?.(
      issueCodeRef,
      new URL(issueCodeRef.module),
      {
        realmURL: boardRealmURL,
        doc: {
          data: {
            type: 'card',
            attributes: { [fieldName]: fieldValue },
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
    let fieldName = this.groupByFieldName;
    this.args.model.placements = newPlacements.map((p) => {
      let card = cards[p.index] as any;
      if (card) {
        if (p.columnId === 'uncategorized') {
          (card as any)[fieldName] = undefined;
        } else if ((card as any)[fieldName] !== p.columnId) {
          (card as any)[fieldName] = p.columnId;
        }
      }
      return Object.assign(new KanbanBoardPlacement(), {
        itemId: card?.id ?? '',
        columnKey: p.columnId,
        sortOrder: p.sortOrder,
      });
    });
    if (this.hideEmpty) {
      this.handleColumnsChange(
        this.columns.map((col: KanbanColumnConfig) =>
          newPlacements.filter((p) => p.columnId === col.key).length === 0
            ? { ...col, collapsed: true }
            : col,
        ),
      );
    }
  };

  get placements(): KanbanPlacement[] {
    let stored = this.args.model?.placements;
    let cards = this.args.model?.cards ?? [];
    let fieldName = this.groupByFieldName;
    let fallbackKey = this.args.model.groupByFallbackKey;

    let resolveColumn = (fieldValue: string | null | undefined): string => {
      return (
        (fieldValue
          ? this.columns.find((c) => c.key === fieldValue)?.key
          : undefined) ??
        (fallbackKey
          ? this.columns.find((c) => c.key === fallbackKey)?.key
          : undefined) ??
        this.columns.find((c) => c.key === 'uncategorized')?.key ??
        this.firstColumn?.key ??
        ''
      );
    };

    if (stored?.length) {
      let placedCardIds = new Set(stored.map((p) => p.itemId));
      let resolved = stored
        .map((p) => {
          let cardIdx = cards.findIndex((c) => (c as any).id === p.itemId);
          if (cardIdx === -1) return null;
          let card = cards[cardIdx] as any;
          let colKey = resolveColumn(card[fieldName] ?? p.columnKey);
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
        .map(({ card, idx }, i) => ({
          columnId: resolveColumn((card as any)[fieldName]),
          index: idx,
          sortOrder: maxOrder + 1 + i,
        }));
      return [...resolved, ...unplaced];
    }
    return cards.map((card, idx) => ({
      columnId: resolveColumn((card as any)[fieldName]),
      index: idx,
      sortOrder: idx,
    }));
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
          <FieldContainer
            @label='Group by'
            class='toolbar-field group-by-selector'
            data-test-group-by-selector
          >
            <BoxelSelect
              @options={{this.groupByDimensions}}
              @selected={{this.selectedGroupByDimension}}
              @onChange={{this.updateGroupBy}}
              @renderInPlace={{true}}
              as |dim|
            >
              <span data-test-group-by-option={{dim.key}}>{{dim.label}}</span>
            </BoxelSelect>
          </FieldContainer>
          <FieldContainer
            @label='Hide empty'
            @inline={{true}}
            class='toolbar-field'
          >
            <Switch
              @isEnabled={{this.hideEmpty}}
              @onChange={{this.toggleHideEmptyColumns}}
              @label='Hide empty columns'
              data-test-hide-empty-switch
            />
          </FieldContainer>
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
            @hideEmpty={{this.hideEmpty}}
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
            @columns={{this.configurableColumns}}
            @cardCounts={{this.columnCardCountsByKey}}
            @onClose={{this.toggleSidebar}}
            @onToggleCollapsed={{this.handleToggleCollapsed}}
            @onLabelChange={{this.handleLabelChange}}
            @onColorChange={{this.handleColorChange}}
            @onWipLimitChange={{this.handleWipLimitChange}}
            @onReorder={{this.handleColumnsChange}}
            @hideEmpty={{this.hideEmpty}}
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
        display: flex;
        flex-direction: column;
        background-color: var(--board-bg);
        color: var(--board-fg);
        overflow: hidden;
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
        gap: var(--boxel-sp-sm);
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
      .toolbar-field {
        --boxel-field-label-font-size: 0.75rem;
        --boxel-field-label-color: var(--board-muted-fg);
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        white-space: nowrap;
      }
      .group-by-selector :deep(.label-container) {
        padding-top: unset;
      }
      .group-by-selector :deep(.ember-power-select-trigger) {
        width: 7rem;
      }
      .group-by-selector :deep(.ember-power-select-trigger),
      .group-by-selector :deep(.boxel-trigger-content),
      .group-by-selector :deep(.boxel-trigger-content > span) {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .group-by-selector :deep(.ember-power-select-dropdown) {
        min-width: max-content;
      }
      .group-by-selector :deep(.ember-power-select-option) {
        white-space: nowrap;
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
        position: relative;
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
        z-index: 1;
      }
      .kanban-config-sidebar-wrap.is-open {
        width: 19rem;
      }
      .kanban-config-sidebar-wrap > :deep(aside) {
        border-top: none;
      }
    </style>
  </template>
}

// ── IssueTracker ──────────────────────────────────────────────────────

export class IssueTracker extends KanbanBoard {
  static displayName = 'Issue Tracker';

  @field project = linksTo(() => Project);
  @field groupBy = contains(GroupByField);
  @field groupByFallbackKey = contains(StringField);
  @field cards = linksToMany(() => Issue, {
    computeVia: function (this: IssueTracker) {
      return this.project?.issues;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: IssueTracker) {
      let cardTitle =
        this.cardInfo.name?.trim() ??
        this.boardTitle?.trim() ??
        this.project?.cardTitle;
      return cardTitle ?? 'Issue Tracker Board';
    },
  });

  static isolated = IssueTrackerIsolated;
}
