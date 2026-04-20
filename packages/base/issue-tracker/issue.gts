import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  CSSField,
  CssImportField,
} from '../card-api';
import enumField from '../enum';
import StringField from '../string';
import NumberField from '../number';
import DateField from '../date';
import MarkdownField from '../markdown';
import { CommentField } from './comment';

import { FieldContainer, Pill } from '@cardstack/boxel-ui/components';

export const issueStatusOptions = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'review', label: 'In Review' },
  { value: 'done', label: 'Done' },
];

export const issuePriorityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const issueTypeOptions = [
  { value: 'bootstrap', label: 'Bootstrap' },
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'task', label: 'Task' },
  { value: 'research', label: 'Research' },
  { value: 'infrastructure', label: 'Infrastructure' },
];

function makeIssueOptionFields(options: { value: string; label: string }[]) {
  return options.map((option) => new IssueOptionField(option));
}

export const projectStatusOptions = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

class IssueOptionField extends FieldDef {
  static displayName = 'Issue Option';
  @field value = contains(StringField);
  @field label = contains(StringField);

  static edit = class Edit extends Component<typeof IssueOptionField> {
    <template>
      <div class='option-edit'>
        <FieldContainer @label='Label' @vertical={{true}}>
          <@fields.label />
        </FieldContainer>
        <FieldContainer @label='Id' @vertical={{true}}>
          <@fields.value />
        </FieldContainer>
      </div>
      <style scoped>
        .option-edit {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: var(--boxel-sp);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof IssueOptionField> {
    <template>
      <span class='option-item'>
        <span class='option-label'>{{if @model.label @model.label '—'}}</span>
        <span class='option-value'>{{@model.value}}</span>
      </span>
      <style scoped>
        .option-item {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: 0.8125rem;
        }
        .option-label {
          font-weight: 500;
          color: var(--foreground);
        }
        .option-value {
          font-size: 0.75rem;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}

const IssueStatusField = enumField(StringField, {
  options: function (this: any) {
    const opts = this.project?.issueStatusOptions;
    return opts?.length ? opts : issueStatusOptions;
  },
});

const IssuePriorityField = enumField(StringField, {
  options: function (this: any) {
    const opts = this.project?.issuePriorityOptions;
    return opts?.length ? opts : issuePriorityOptions;
  },
});

const IssueTypeField = enumField(StringField, {
  options: function (this: any) {
    const opts = this.project?.issueTypeOptions;
    return opts?.length ? opts : issueTypeOptions;
  },
});

function getStatusVariant(statusId?: string) {
  switch (statusId) {
    case 'in_progress':
    case 'active':
      return 'primary';
    case 'blocked':
    case 'on_hold':
      return 'destructive';
    case 'review':
    case 'completed':
      return 'accent';
    case 'done':
    case 'archived':
      return 'muted';
    default:
      return 'default';
  }
}

export class Issue extends CardDef {
  static displayName = 'Issue';

  @field issueId = contains(StringField);
  @field summary = contains(StringField);
  @field description = contains(MarkdownField);
  @field issueType = contains(IssueTypeField);
  @field status = contains(IssueStatusField);
  @field computedStatus = contains(IssueStatusField, {
    computeVia: function (this: Issue) {
      if (this.status) {
        return this.status;
      }
      return (
        this.project?.issueStatusOptions?.[0]?.value ??
        issueStatusOptions[0]?.value
      );
    },
  });
  @field priority = contains(IssuePriorityField);
  @field statusBoardOrder = contains(NumberField);
  @field priorityBoardOrder = contains(NumberField);
  @field issueTypeBoardOrder = contains(NumberField);
  @field project = linksTo(() => Project);
  @field relatedTickets = linksToMany(() => Issue);
  @field kanbanBoards = linksToMany(() => CardDef, {
    computeVia: function (this: Issue) {
      return this.project?.kanbanBoards ?? [];
    },
  });
  @field comments = containsMany(CommentField);

  @field cssVariables = contains(CSSField, {
    computeVia: function (this: Issue) {
      return (
        this.cardInfo.theme?.cssVariables ??
        this.project?.cardInfo?.theme?.cssVariables
      );
    },
  });

  @field cssImports = containsMany(CssImportField, {
    computeVia: function (this: Issue) {
      return (
        this.cardInfo.theme?.cssImports ??
        this.project?.cardInfo?.theme?.cssImports ??
        []
      );
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Issue) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.summary ?? 'Untitled Issue');
    },
  });

  static fitted = class Fitted extends Component<typeof Issue> {
    <template>
      <div class='ticket-card compact'>
        <div class='row'>
          <div>
            <Pill @size='extra-small' @variant='secondary'>
              {{#if @model.issueId}}
                <@fields.issueId />
              {{else}}
                Issue
              {{/if}}
            </Pill>
            {{#if @model.issueType}}
              <Pill @size='extra-small' @variant='default'>
                <@fields.issueType @format='atom' />
              </Pill>
            {{/if}}
            {{#if @model.priority}}
              <Pill @size='extra-small' @variant='default'>
                <@fields.priority @format='atom' />
              </Pill>
            {{/if}}
          </div>
          <Pill
            @size='extra-small'
            @variant={{getStatusVariant @model.computedStatus}}
          >
            <@fields.computedStatus @format='atom' />
          </Pill>
        </div>
        <div class='title'><@fields.cardTitle /></div>
      </div>
      <style scoped>
        .ticket-card {
          display: grid;
          gap: 0.35rem;
          overflow: hidden;
        }
        .compact {
          padding: 0.75rem;
        }
        .row {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          font-size: 0.8rem;
        }
        @container fitted-card (height < 65px) {
          .compact {
            padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          }
          .row {
            display: none;
          }
          .title {
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static edit = class Edit extends Component<typeof Issue> {
    <template>
      <div class='issue-edit'>
        <div class='meta-row'>
          <div class='meta-cell'>
            <FieldContainer @label='Issue ID'>
              <@fields.issueId />
            </FieldContainer>
          </div>
        </div>

        <FieldContainer @tag='label' @label='Title' @vertical={{true}}>
          <@fields.summary />
        </FieldContainer>

        <FieldContainer @tag='label' @label='Description' @vertical={{true}}>
          <@fields.description />
        </FieldContainer>

        <section class='options-section'>
          <div class='options-section-header'>
            <h2 class='section-title'>Issue Configuration</h2>
            <p class='section-copy'>
              Set the issue status, type, and priority using the options
              available in this project.
            </p>
          </div>
          <div class='options-row'>
            <div class='option-panel'>
              <div class='option-panel-header'>
                <h3 class='option-title'>Status</h3>
                <p class='option-copy'>
                  Controls the current workflow state for this issue.
                </p>
              </div>
              <FieldContainer @tag='label' @label='Status' @hideLabel={{true}}>
                <@fields.status />
              </FieldContainer>
            </div>
            <div class='option-panel'>
              <div class='option-panel-header'>
                <h3 class='option-title'>Type</h3>
                <p class='option-copy'>
                  Classifies the issue as work like feature, bug, or research.
                </p>
              </div>
              <FieldContainer @tag='label' @label='Type' @hideLabel={{true}}>
                <@fields.issueType />
              </FieldContainer>
            </div>
            <div class='option-panel'>
              <div class='option-panel-header'>
                <h3 class='option-title'>Priority</h3>
                <p class='option-copy'>
                  Indicates the urgency or importance of this issue.
                </p>
              </div>
              <FieldContainer
                @tag='label'
                @label='Priority'
                @hideLabel={{true}}
              >
                <@fields.priority />
              </FieldContainer>
            </div>
          </div>
        </section>

        <div class='bottom-row'>
          <div class='bottom-cell'>
            <FieldContainer @label='Project' @vertical={{true}}>
              <@fields.project />
            </FieldContainer>
          </div>
          <div class='bottom-cell'>
            <FieldContainer @label='Related Tickets' @vertical={{true}}>
              <@fields.relatedTickets />
            </FieldContainer>
          </div>
        </div>
      </div>
      <style scoped>
        .issue-edit {
          display: grid;
          gap: var(--boxel-sp-xl);
          padding: var(--boxel-sp-xl);
        }
        .meta-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--boxel-sp);
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
        .section-title {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .section-copy {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-600));
        }
        .options-row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--boxel-sp);
        }
        .option-panel {
          display: grid;
          gap: var(--boxel-sp-sm);
          min-width: 0;
          padding: var(--boxel-sp);
          background: var(--muted, var(--boxel-100));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius);
          box-shadow: inset 0 1px 0
            color-mix(in oklch, var(--card) 35%, transparent);
        }
        .option-panel-header {
          display: grid;
          gap: var(--boxel-sp-3xs);
        }
        .option-title {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .option-copy {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.45;
          color: var(--muted-foreground, var(--boxel-600));
        }
        .bottom-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
        }
        .meta-cell,
        .bottom-cell {
          min-width: 0;
        }
        @media (max-width: 60rem) {
          .options-row {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Issue> {
    <template>
      <article class='issue'>
        <header class='issue-header'>
          <div class='issue-meta-top'>
            <Pill @size='extra-small' @variant='secondary'>
              {{#if @model.issueId}}
                <@fields.issueId />
              {{else}}
                Issue
              {{/if}}
            </Pill>
            <Pill
              @size='extra-small'
              @variant={{getStatusVariant @model.computedStatus}}
            >
              <@fields.computedStatus @format='atom' />
            </Pill>
          </div>

          <h1 class='issue-title'><@fields.cardTitle /></h1>

          <dl class='issue-attrs'>
            {{#if @model.project}}
              <div class='attr-item'>
                <dt class='attr-label'>Project</dt>
                <dd class='attr-value'><@fields.project @format='atom' /></dd>
              </div>
            {{/if}}
            {{#if @model.kanbanBoards.length}}
              <div class='attr-item'>
                <dt class='attr-label'>Board</dt>
                <dd class='attr-value'>
                  <@fields.kanbanBoards @format='atom' />
                </dd>
              </div>
            {{/if}}
            {{#if @model.issueType}}
              <div class='attr-item'>
                <dt class='attr-label'>Type</dt>
                <dd class='attr-value'><@fields.issueType @format='atom' /></dd>
              </div>
            {{/if}}
            {{#if @model.priority}}
              <div class='attr-item'>
                <dt class='attr-label'>Priority</dt>
                <dd class='attr-value'><@fields.priority @format='atom' /></dd>
              </div>
            {{/if}}
          </dl>
        </header>

        <section class='issue-body'>
          <@fields.description />
        </section>

        {{#if @model.relatedTickets.length}}
          <section class='issue-related'>
            <h2 class='section-label'>Related Tickets</h2>
            <@fields.relatedTickets />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .issue {
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xl);
          max-width: 48rem;
          margin: 0 auto;
          padding: var(--boxel-sp-xl);
        }
        .issue-header {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
          padding-bottom: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border);
        }
        .issue-meta-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        .issue-title {
          font-size: 1.5rem;
          font-weight: 700;
          line-height: 1.3;
          margin: 0;
          color: var(--foreground);
        }
        .issue-attrs {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
          margin: 0;
        }
        .attr-item {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .attr-label {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--muted-foreground);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .attr-value {
          margin: 0;
          font-size: 0.875rem;
          color: var(--foreground);
        }
        .issue-body {
          flex: 1;
        }
        .issue-body :deep(p:first-child) {
          margin-top: 0;
        }
        .issue-related {
          border-top: 1px solid var(--border);
          padding-top: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
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

export class Project extends CardDef {
  static displayName = 'Project';
  static prefersWideFormat = true;

  @field projectCode = contains(StringField);
  @field projectName = contains(StringField);
  @field projectStatus = contains(
    enumField(StringField, { options: projectStatusOptions }),
  );
  @field description = contains(MarkdownField);
  @field dueDate = contains(DateField);
  @field kanbanBoards = linksToMany(() => CardDef, {
    query: {
      filter: {
        on: {
          module: 'https://cardstack.com/base/issue-tracker/kanban-board',
          name: 'KanbanBoard',
        },
        eq: { 'project.id': '$this.id' },
      },
    },
  });
  @field issuePriorityOptions = containsMany(IssueOptionField);
  @field issueStatusOptions = containsMany(IssueOptionField);
  @field issueTypeOptions = containsMany(IssueOptionField);
  @field issues = linksToMany(() => Issue, {
    query: {
      filter: {
        on: {
          module: 'https://cardstack.com/base/issue-tracker/issue',
          name: 'Issue',
        },
        eq: { 'project.id': '$this.id' },
      },
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Project) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.projectName ?? 'Untitled Project');
    },
  });

  static edit = class Edit extends Component<typeof Project> {
    constructor(owner: unknown, args: any) {
      super(owner, args);
      Promise.resolve().then(() => {
        let model = this.args.model as Project | undefined;
        if (!model) return;

        if (!model.issuePriorityOptions?.length) {
          model.issuePriorityOptions =
            makeIssueOptionFields(issuePriorityOptions);
        }
        if (!model.issueStatusOptions?.length) {
          model.issueStatusOptions = makeIssueOptionFields(issueStatusOptions);
        }
        if (!model.issueTypeOptions?.length) {
          model.issueTypeOptions = makeIssueOptionFields(issueTypeOptions);
        }
      });
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
          <FieldContainer @label='Due Date' @vertical={{true}}>
            <@fields.dueDate />
          </FieldContainer>
        </div>
        <div class='row'>
          <FieldContainer @label='Kanban Board' @vertical={{true}}>
            <@fields.kanbanBoards />
          </FieldContainer>
        </div>
        <FieldContainer @label='Description' @vertical={{true}}>
          <@fields.description />
        </FieldContainer>
        <div class='row'>
          <FieldContainer @label='Theme' @vertical={{true}}>
            <@fields.cardInfo.theme />
          </FieldContainer>
        </div>

        <FieldContainer @label='Issue Status Options' @vertical={{true}}>
          <@fields.issueStatusOptions />
        </FieldContainer>

        <FieldContainer @label='Issue Priority Options' @vertical={{true}}>
          <@fields.issuePriorityOptions />
        </FieldContainer>

        <FieldContainer @label='Issue Type Options' @vertical={{true}}>
          <@fields.issueTypeOptions />
        </FieldContainer>
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
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Project> {
    <template>
      <div class='project-card compact'>
        <div class='row'>
          <Pill @size='extra-small' @variant='secondary'>
            {{#if @model.projectCode}}<@fields.projectCode
              />{{else}}PROJECT{{/if}}
          </Pill>
          <Pill
            @size='extra-small'
            @variant={{getStatusVariant @model.projectStatus}}
          >
            {{#if @model.projectStatus}}
              <@fields.projectStatus @format='atom' />
            {{else}}
              Planning
            {{/if}}
          </Pill>
        </div>
        <div class='title'><@fields.cardTitle /></div>
      </div>
      <style scoped>
        .project-card {
          display: grid;
          gap: 0.35rem;
          overflow: hidden;
        }
        .compact {
          padding: 0.75rem;
        }
        .row {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          font-size: 0.8rem;
        }
        @container fitted-card (height < 65px) {
          .compact {
            padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          }
          .row {
            display: none;
          }
          .title {
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof Project> {
    <template>
      <div class='background-container'>
        <article class='surface'>
          <header class='project-header'>
            <div class='project-meta-top'>
              <Pill @size='extra-small' @variant='secondary'>
                {{#if @model.projectCode}}
                  <@fields.projectCode />
                {{else}}
                  PROJECT
                {{/if}}
              </Pill>
              <Pill
                @size='extra-small'
                @variant={{getStatusVariant @model.projectStatus}}
              >
                {{#if @model.projectStatus}}
                  <@fields.projectStatus @format='atom' />
                {{else}}
                  Planning
                {{/if}}
              </Pill>
            </div>
            <h1><@fields.cardTitle /></h1>
            <dl class='project-attrs'>
              {{#if @model.dueDate}}
                <div class='attr-item'>
                  <dt class='attr-label'>Due Date</dt>
                  <dd class='attr-value'><@fields.dueDate @format='atom' /></dd>
                </div>
              {{/if}}
              {{#if @model.kanbanBoards.length}}
                <div class='attr-item'>
                  <dt class='attr-label'>Board</dt>
                  <dd class='attr-value'>
                    <@fields.kanbanBoards @format='atom' />
                  </dd>
                </div>
              {{/if}}
            </dl>
          </header>

          <section class='project-section'>
            <h2 class='section-label'>Description</h2>
            <@fields.description />
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
        .project-attrs {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
          margin: 0;
        }
        .attr-item {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .attr-label {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--muted-foreground);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .attr-value {
          margin: 0;
          font-size: 0.875rem;
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
