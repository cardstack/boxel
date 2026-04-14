import {
  CardDef,
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

import { FieldContainer, Pill } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

export const issueStatusOptions = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'review', label: 'In Review' },
  { value: 'done', label: 'Done' },
];

const projectStatusOptions = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

export const issuePriorityOptions = [
  { value: 'unset', label: 'Unset' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const issueTypeOptions = [
  { value: 'unset', label: 'Unset' },
  { value: 'task', label: 'Task' },
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'research', label: 'Research' },
  { value: 'infrastructure', label: 'Infrastructure' },
];

const IssueStatusField = enumField(StringField, {
  options: issueStatusOptions,
});

const IssuePriorityField = enumField(StringField, {
  options: issuePriorityOptions,
});

const IssueTypeField = enumField(StringField, {
  options: issueTypeOptions,
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

  @field ticketId = contains(StringField);
  @field title = contains(StringField);
  @field description = contains(MarkdownField);
  @field status = contains(IssueStatusField);
  @field computedStatus = contains(IssueStatusField, {
    computeVia: function (this: Issue) {
      return this.status ?? 'backlog';
    },
  });
  @field ticketType = contains(IssueTypeField);
  @field computedTicketType = contains(IssueTypeField, {
    computeVia: function (this: Issue) {
      return this.ticketType ?? 'unset';
    },
  });
  @field priority = contains(IssuePriorityField);
  @field computedPriority = contains(IssuePriorityField, {
    computeVia: function (this: Issue) {
      return this.priority ?? 'unset';
    },
  });
  @field statusBoardOrder = contains(NumberField);
  @field priorityBoardOrder = contains(NumberField);
  @field ticketTypeBoardOrder = contains(NumberField);
  @field relatedTickets = linksToMany(() => Issue);
  @field project = linksTo(() => Project);

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
        : (this.title ?? 'Untitled Issue');
    },
  });

  static fitted = class Fitted extends Component<typeof Issue> {
    <template>
      <div class='ticket-card compact'>
        <div class='row'>
          <div>
            {{#if @model.ticketId}}
              <Pill @size='extra-small' @variant='secondary'>
                <@fields.ticketId />
              </Pill>
            {{/if}}
            {{#unless (eq @model.computedTicketType 'unset')}}
              <Pill @size='extra-small' @variant='default'>
                <@fields.computedTicketType @format='atom' />
              </Pill>
            {{/unless}}
            {{#unless (eq @model.computedPriority 'unset')}}
              <Pill @size='extra-small' @variant='default'>
                <@fields.computedPriority @format='atom' />
              </Pill>
            {{/unless}}
          </div>
          <Pill
            @size='extra-small'
            @variant={{getStatusVariant @model.computedStatus}}
          >
            <@fields.computedStatus @format='atom' />
          </Pill>
        </div>
        <div><@fields.cardTitle /></div>
      </div>
      <style scoped>
        .ticket-card {
          display: grid;
          gap: 0.35rem;
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
      </style>
    </template>
  };

  static embedded = this.fitted;

  static edit = class Edit extends Component<typeof Issue> {
    <template>
      <div class='issue-edit'>
        <div class='meta-row'>
          <div class='meta-cell'>
            <FieldContainer @label='Ticket ID' @vertical={{true}}>
              <@fields.ticketId />
            </FieldContainer>
          </div>
          <div class='meta-cell'>
            <FieldContainer @label='Status' @vertical={{true}}>
              <@fields.status />
            </FieldContainer>
          </div>
          <div class='meta-cell'>
            <FieldContainer @label='Type' @vertical={{true}}>
              <@fields.ticketType />
            </FieldContainer>
          </div>
          <div class='meta-cell'>
            <FieldContainer @label='Priority' @vertical={{true}}>
              <@fields.priority />
            </FieldContainer>
          </div>
        </div>

        <FieldContainer @label='Title' @vertical={{true}}>
          <@fields.title />
        </FieldContainer>

        <FieldContainer @label='Description' @vertical={{true}}>
          <@fields.description />
        </FieldContainer>

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
          grid-template-columns: repeat(4, 1fr);
          gap: var(--boxel-sp);
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
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Issue> {
    <template>
      <article class='issue'>
        <header class='issue-header'>
          <div class='issue-pills'>
            {{#if @model.ticketId}}
              <Pill @size='extra-small' @variant='secondary'>
                <@fields.ticketId />
              </Pill>
            {{/if}}
            <Pill
              @size='extra-small'
              @variant={{getStatusVariant @model.computedStatus}}
            >
              <@fields.computedStatus @format='atom' />
            </Pill>
            {{#unless (eq @model.computedTicketType 'unset')}}
              <Pill @size='extra-small' @variant='default'>
                <@fields.computedTicketType @format='atom' />
              </Pill>
            {{/unless}}
            {{#unless (eq @model.computedPriority 'unset')}}
              <Pill @size='extra-small' @variant='default'>
                <@fields.computedPriority @format='atom' />
              </Pill>
            {{/unless}}
          </div>
          <h1 class='issue-title'><@fields.cardTitle /></h1>
          {{#if @model.project}}
            <div class='issue-project'>
              <span class='dim-label'>Project</span>
              <@fields.project @format='atom' />
            </div>
          {{/if}}
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
          padding-bottom: var(--boxel-sp-xl);
          border-bottom: 1px solid var(--border);
        }
        .issue-pills {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .issue-title {
          font-size: 1.5rem;
          font-weight: 700;
          line-height: 1.3;
          margin: var(--boxel-sp-xs) 0 0;
          color: var(--foreground);
        }
        .issue-project {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          margin-top: var(--boxel-sp-xs);
        }
        .dim-label {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--muted-foreground);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .issue-body {
          flex: 1;
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
        }
      </style>
    </template>
  };
}

export class Project extends CardDef {
  static displayName = 'Project';
  static prefersWideFormat = true;

  @field projectCode = contains(StringField);
  @field projectStatus = contains(
    enumField(StringField, { options: projectStatusOptions }),
  );
  @field title = contains(StringField);
  @field description = contains(MarkdownField);
  @field dueDate = contains(DateField);
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
        : (this.title ?? 'Untitled Project');
    },
  });

  static fitted = class Fitted extends Component<typeof Project> {
    <template>
      <div class='project-card compact'>
        <div class='row'>
          <Pill @size='extra-small' @variant='secondary'>
            {{if @model.projectCode @model.projectCode 'PROJECT'}}
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
        <div><@fields.cardTitle /></div>
      </div>
      <style scoped>
        .project-card {
          display: grid;
          gap: 0.35rem;
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
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof Project> {
    <template>
      <article class='surface'>
        <header>
          <div class='row'>
            <Pill @size='extra-small' @variant='secondary'>
              {{if @model.projectCode @model.projectCode 'PROJECT'}}
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
        </header>
        <section>
          <h2>Description</h2>
          <@fields.description />
        </section>
        {{#if @model.issues.length}}
          <section>
            <h2>Issues</h2>
            <@fields.issues />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .surface {
          padding: 1.5rem;
          display: grid;
          gap: 1rem;
        }
        .row {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
        }
      </style>
    </template>
  };
}
