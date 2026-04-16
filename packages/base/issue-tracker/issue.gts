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

import { FieldContainer, Pill } from '@cardstack/boxel-ui/components';
import { dasherize } from '@cardstack/boxel-ui/helpers';

export const issueStatusLabels = [
  'Backlog',
  'In Progress',
  'Blocked',
  'In Review',
  'Done',
];

export const issuePriorityLabels = ['Low', 'Medium', 'High', 'Critical'];

export const issueTypeLabels = [
  'Bootstrap',
  'Feature',
  'Bug',
  'Task',
  'Research',
  'Infrastructure',
];

function buildIssueOptions(labels: string[]) {
  return labels.map((label) => ({
    value: dasherize(label),
    label,
  }));
}

export const issueStatusOptions = buildIssueOptions(issueStatusLabels);
export const issuePriorityOptions = buildIssueOptions(issuePriorityLabels);
export const issueTypeOptions = buildIssueOptions(issueTypeLabels);

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
    case 'in-progress':
    case 'active':
      return 'primary';
    case 'blocked':
    case 'on_hold':
      return 'destructive';
    case 'in-review':
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
            <FieldContainer @label='Issue ID'>
              <@fields.issueId />
            </FieldContainer>
          </div>
        </div>

        <FieldContainer @label='Title' @vertical={{true}}>
          <@fields.summary />
        </FieldContainer>

        <FieldContainer @label='Description' @vertical={{true}}>
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
              <FieldContainer @label='Status' @vertical={{true}}>
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
              <FieldContainer @label='Type' @vertical={{true}}>
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
              <FieldContainer @label='Priority' @vertical={{true}}>
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
          box-shadow: inset 0 1px 0 rgb(from var(--card, white) r g b / 0.35);
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
          <div class='issue-pills'>
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
          <h1 class='issue-title'><@fields.cardTitle /></h1>

          <div class='issue-project'>
            {{#if @model.project}}
              <span class='dim-label'>Project</span>
              <@fields.project @format='atom' />
            {{else}}
              <em class='dim-label'>No Project</em>
            {{/if}}
          </div>

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
          justify-content: space-between;
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
  @field projectName = contains(StringField);
  @field projectStatus = contains(
    enumField(StringField, { options: projectStatusOptions }),
  );
  @field description = contains(MarkdownField);
  @field dueDate = contains(DateField);
  @field issuePriorityLabels = containsMany(StringField);
  @field issuePriorityOptions = containsMany(IssueOptionField, {
    computeVia: function (this: Project) {
      return this.issuePriorityLabels?.map(
        (l) =>
          new IssueOptionField({
            value: dasherize(l),
            label: l,
          }),
      );
    },
  });
  @field issueStatusLabels = containsMany(StringField);
  @field issueStatusOptions = containsMany(IssueOptionField, {
    computeVia: function (this: Project) {
      return this.issueStatusLabels?.map(
        (l) =>
          new IssueOptionField({
            value: dasherize(l),
            label: l,
          }),
      );
    },
  });
  @field issueTypeLabels = containsMany(StringField);
  @field issueTypeOptions = containsMany(IssueOptionField, {
    computeVia: function (this: Project) {
      return this.issueTypeLabels?.map(
        (l) =>
          new IssueOptionField({
            value: dasherize(l),
            label: l,
          }),
      );
    },
  });
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

        if (!model.issuePriorityLabels?.length) {
          model.issuePriorityLabels = issuePriorityLabels;
        }
        if (!model.issueStatusLabels?.length) {
          model.issueStatusLabels = issueStatusLabels;
        }
        if (!model.issueTypeLabels?.length) {
          model.issueTypeLabels = issueTypeLabels;
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
        <FieldContainer @label='Description' @vertical={{true}}>
          <@fields.description />
        </FieldContainer>
        <div class='row'>
          <FieldContainer @label='Theme' @vertical={{true}}>
            <@fields.cardInfo.theme />
          </FieldContainer>
        </div>

        Issue Status Labels:
        <@fields.issueStatusLabels />

        Issue Priority Labels:
        <@fields.issuePriorityLabels />

        Issue Type Labels:
        <@fields.issueTypeLabels />
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
