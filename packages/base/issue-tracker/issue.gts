import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  linksToMany,
} from '../card-api';
import enumField from '../enum';
import StringField from '../string';
import DateField from '../date';
import DateTimeField from '../datetime';
import MarkdownField from '../markdown';
import NumberField from '../number';

import { AgentProfile } from './agent-profile';
import { KnowledgeArticle } from './knowledge-article';

import { Pill } from '@cardstack/boxel-ui/components';

const issueStatusOptions = [
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
  @field priority = contains(IssuePriorityField);
  @field project = linksTo(() => Project);
  @field assignedAgent = linksTo(() => AgentProfile);
  @field relatedTickets = linksToMany(() => Issue);
  @field relatedKnowledge = linksToMany(() => KnowledgeArticle);
  @field acceptanceCriteria = contains(MarkdownField);
  @field agentNotes = contains(MarkdownField);
  @field estimatedHours = contains(NumberField);
  @field actualHours = contains(NumberField);
  @field createdAt = contains(DateTimeField);
  @field updatedAt = contains(DateTimeField);

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
          <Pill @size='extra-small' @variant={{getStatusVariant @model.status}}>
            {{#if @model.status}}
              <@fields.status @format='atom' />
            {{else}}
              Backlog
            {{/if}}
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
              @variant={{getStatusVariant @model.status}}
            >
              {{#if @model.status}}
                <@fields.status @format='atom' />
              {{else}}
                Backlog
              {{/if}}
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
        {{#if @model.description}}
          <section>
            <h2>Description</h2>
            <@fields.description />
          </section>
        {{/if}}
        {{#if @model.acceptanceCriteria}}
          <section>
            <h2>Acceptance Criteria</h2>
            <@fields.acceptanceCriteria />
          </section>
        {{/if}}
        {{#if @model.agentNotes}}
          <section>
            <h2>Agent Notes</h2>
            <@fields.agentNotes />
          </section>
        {{/if}}
        {{#if @model.relatedKnowledge.length}}
          <section>
            <h2>Related Knowledge</h2>
            <@fields.relatedKnowledge />
          </section>
        {{/if}}
        {{#if @model.relatedTickets.length}}
          <section>
            <h2>Related Tickets</h2>
            <@fields.relatedTickets />
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

export class Project extends CardDef {
  static displayName = 'Project';
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field projectCode = contains(StringField);
  @field projectStatus = contains(
    enumField(StringField, { options: projectStatusOptions }),
  );
  @field deadline = contains(DateField);
  @field objective = contains(MarkdownField);
  @field scope = contains(MarkdownField);
  @field technicalContext = contains(MarkdownField);
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
  @field knowledgeBase = linksToMany(() => KnowledgeArticle);
  @field teamAgents = linksToMany(() => AgentProfile);
  @field successCriteria = contains(MarkdownField);
  @field risks = contains(MarkdownField);
  @field testArtifactsRealmUrl = contains(StringField);
  @field createdAt = contains(DateTimeField);

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
        {{#if @model.objective}}
          <section>
            <h2>Objective</h2>
            <@fields.objective />
          </section>
        {{/if}}
        {{#if @model.scope}}
          <section>
            <h2>Scope</h2>
            <@fields.scope />
          </section>
        {{/if}}
        {{#if @model.technicalContext}}
          <section>
            <h2>Technical Context</h2>
            <@fields.technicalContext />
          </section>
        {{/if}}
        {{#if @model.successCriteria}}
          <section>
            <h2>Success Criteria</h2>
            <@fields.successCriteria />
          </section>
        {{/if}}
        {{#if @model.risks}}
          <section>
            <h2>Risks</h2>
            <@fields.risks />
          </section>
        {{/if}}
        {{#if @model.issues.length}}
          <section>
            <h2>Tickets</h2>
            <@fields.issues />
          </section>
        {{/if}}
        {{#if @model.knowledgeBase.length}}
          <section>
            <h2>Knowledge Base</h2>
            <@fields.knowledgeBase />
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
