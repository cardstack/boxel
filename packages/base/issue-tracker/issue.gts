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

import { Pill } from '@cardstack/boxel-ui/components';

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

const IssuePriorityField = enumField(StringField, {
  options: [
    { value: 'critical', label: 'Critical' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ],
});

const IssueTypeField = enumField(StringField, {
  options: [
    { value: 'feature', label: 'Feature' },
    { value: 'bug', label: 'Bug' },
    { value: 'task', label: 'Task' },
    { value: 'research', label: 'Research' },
    { value: 'infrastructure', label: 'Infrastructure' },
  ],
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
  @field ticketType = contains(IssueTypeField);
  @field status = contains(
    enumField(StringField, { options: issueStatusOptions }),
  );
  @field computedStatus = contains(
    enumField(StringField, { options: issueStatusOptions }),
    {
      computeVia: function (this: Issue) {
        return this.status ?? issueStatusOptions?.[0]?.value;
      },
    },
  );
  @field boardOrder = contains(NumberField);
  @field priority = contains(IssuePriorityField);
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
          <Pill @size='extra-small' @variant='secondary'>
            {{if @model.ticketId @model.ticketId 'TICKET'}}
          </Pill>
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

  static isolated = class Isolated extends Component<typeof Issue> {
    <template>
      <article class='surface'>
        <header>
          <div class='row'>
            <Pill @size='extra-small' @variant='secondary'>
              {{if @model.ticketId @model.ticketId 'TICKET'}}
            </Pill>
            <Pill
              @size='extra-small'
              @variant={{getStatusVariant @model.computedStatus}}
            >
              <@fields.computedStatus @format='atom' />
            </Pill>
          </div>
          <h1><@fields.cardTitle /></h1>
        </header>
        {{#if @model.project}}
          <section>
            <h2>Project</h2>
            <@fields.project />
          </section>
        {{/if}}
        <section>
          <h2>Description</h2>
          <@fields.description />
        </section>
        {{#if @model.relatedTickets.length}}
          <aside>
            <h2>Related Tickets</h2>
            <@fields.relatedTickets />
          </aside>
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
