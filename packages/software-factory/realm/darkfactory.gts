import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateTimeField from 'https://cardstack.com/base/datetime';
import DateField from 'https://cardstack.com/base/date';
import MarkdownField from 'https://cardstack.com/base/markdown';
import TextAreaField from 'https://cardstack.com/base/text-area';
import enumField from 'https://cardstack.com/base/enum';

export const TicketStatusField = enumField(StringField, {
  options: [
    { value: 'backlog', label: 'Backlog' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'review', label: 'In Review' },
    { value: 'done', label: 'Done' },
  ],
});

export const TicketPriorityField = enumField(StringField, {
  options: [
    { value: 'critical', label: 'Critical' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ],
});

export const TicketTypeField = enumField(StringField, {
  options: [
    { value: 'feature', label: 'Feature' },
    { value: 'bug', label: 'Bug' },
    { value: 'task', label: 'Task' },
    { value: 'research', label: 'Research' },
    { value: 'infrastructure', label: 'Infrastructure' },
  ],
});

export const ProjectStatusField = enumField(StringField, {
  options: [
    { value: 'planning', label: 'Planning' },
    { value: 'active', label: 'Active' },
    { value: 'on_hold', label: 'On Hold' },
    { value: 'completed', label: 'Completed' },
    { value: 'archived', label: 'Archived' },
  ],
});

export const KnowledgeTypeField = enumField(StringField, {
  options: [
    { value: 'architecture', label: 'Architecture' },
    { value: 'decision', label: 'Decision (ADR)' },
    { value: 'runbook', label: 'Runbook' },
    { value: 'context', label: 'Context' },
    { value: 'api', label: 'API Reference' },
    { value: 'onboarding', label: 'Onboarding' },
  ],
});

export class AgentProfile extends CardDef {
  static displayName = 'Agent Profile';

  @field agentId = contains(StringField);
  @field capabilities = containsMany(StringField);
  @field specialization = contains(StringField);
  @field notes = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: AgentProfile) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.agentId ?? 'Unnamed Agent');
    },
  });

  static fitted = class Fitted extends Component<typeof AgentProfile> {
    <template>
      <div class='agent-card compact'>
        <strong>{{if @model.agentId @model.agentId 'Unknown Agent'}}</strong>
        {{#if @model.specialization}}
          <span>{{@model.specialization}}</span>
        {{/if}}
      </div>
      <style scoped>
        .agent-card {
          display: grid;
          gap: 0.25rem;
        }
        .compact {
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--card);
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof AgentProfile> {
    <template>
      <article class='surface'>
        <h1>{{if @model.agentId @model.agentId 'Unknown Agent'}}</h1>
        {{#if @model.specialization}}<p>{{@model.specialization}}</p>{{/if}}
        {{#if @model.capabilities.length}}
          <section>
            <h2>Capabilities</h2>
            <ul>
              {{#each @model.capabilities as |capability|}}
                <li>{{capability}}</li>
              {{/each}}
            </ul>
          </section>
        {{/if}}
        {{#if @model.notes}}
          <section>
            <h2>Notes</h2>
            <@fields.notes />
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

export class KnowledgeArticle extends CardDef {
  static displayName = 'Knowledge Article';

  @field articleTitle = contains(StringField);
  @field articleType = contains(KnowledgeTypeField);
  @field content = contains(MarkdownField);
  @field tags = containsMany(StringField);
  @field lastUpdatedBy = linksTo(() => AgentProfile);
  @field updatedAt = contains(DateTimeField);

  @field title = contains(StringField, {
    computeVia: function (this: KnowledgeArticle) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.articleTitle ?? 'Untitled Article');
    },
  });

  static fitted = class Fitted extends Component<typeof KnowledgeArticle> {
    <template>
      <div class='knowledge-card compact'>
        <div class='kicker'>{{if
            @model.articleType
            @model.articleType
            'article'
          }}</div>
        <strong>{{if
            @model.articleTitle
            @model.articleTitle
            'Untitled Article'
          }}</strong>
      </div>
      <style scoped>
        .knowledge-card {
          display: grid;
          gap: 0.25rem;
        }
        .compact {
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--card);
        }
        .kicker {
          font-size: 0.75rem;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof KnowledgeArticle> {
    <template>
      <article class='surface'>
        <header>
          <div class='kicker'>{{if
              @model.articleType
              @model.articleType
              'article'
            }}</div>
          <h1>{{if
              @model.articleTitle
              @model.articleTitle
              'Untitled Article'
            }}</h1>
        </header>
        {{#if @model.tags.length}}
          <section>
            <h2>Tags</h2>
            <ul>
              {{#each @model.tags as |tag|}}
                <li>{{tag}}</li>
              {{/each}}
            </ul>
          </section>
        {{/if}}
        {{#if @model.content}}
          <section>
            <h2>Content</h2>
            <@fields.content />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .surface {
          padding: 1.5rem;
          display: grid;
          gap: 1rem;
        }
        .kicker {
          font-size: 0.75rem;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}

export class Ticket extends CardDef {
  static displayName = 'Ticket';

  @field ticketId = contains(StringField);
  @field summary = contains(StringField);
  @field description = contains(MarkdownField);
  @field ticketType = contains(TicketTypeField);
  @field status = contains(TicketStatusField);
  @field priority = contains(TicketPriorityField);
  @field project = linksTo(() => Project);
  @field assignedAgent = linksTo(() => AgentProfile);
  @field relatedTickets = linksToMany(() => Ticket);
  @field relatedKnowledge = linksToMany(() => KnowledgeArticle);
  @field acceptanceCriteria = contains(MarkdownField);
  @field agentNotes = contains(MarkdownField);
  @field estimatedHours = contains(NumberField);
  @field actualHours = contains(NumberField);
  @field createdAt = contains(DateTimeField);
  @field updatedAt = contains(DateTimeField);

  @field title = contains(StringField, {
    computeVia: function (this: Ticket) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.summary ?? 'Untitled Ticket');
    },
  });

  static fitted = class Fitted extends Component<typeof Ticket> {
    <template>
      <div class='ticket-card compact'>
        <div class='row'>
          <strong>{{if @model.ticketId @model.ticketId 'TICKET'}}</strong>
          <span>{{if @model.status @model.status 'backlog'}}</span>
        </div>
        <div>{{if @model.summary @model.summary 'Untitled Ticket'}}</div>
      </div>
      <style scoped>
        .ticket-card {
          display: grid;
          gap: 0.35rem;
        }
        .compact {
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--card);
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

  static isolated = class Isolated extends Component<typeof Ticket> {
    <template>
      <article class='surface'>
        <header>
          <div class='row'>
            <strong>{{if @model.ticketId @model.ticketId 'TICKET'}}</strong>
            <span>{{if @model.status @model.status 'backlog'}}</span>
          </div>
          <h1>{{if @model.summary @model.summary 'Untitled Ticket'}}</h1>
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

  @field projectCode = contains(StringField);
  @field projectName = contains(StringField);
  @field projectStatus = contains(ProjectStatusField);
  @field deadline = contains(DateField);
  @field objective = contains(TextAreaField);
  @field scope = contains(MarkdownField);
  @field technicalContext = contains(MarkdownField);
  @field tickets = linksToMany(() => Ticket, {
    query: {
      filter: {
        on: {
          // @ts-ignore this is not a CJS file, import.meta is allowed
          module: new URL('./darkfactory', import.meta.url).href,
          name: 'Ticket',
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

  @field title = contains(StringField, {
    computeVia: function (this: Project) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.projectName ?? 'Untitled Project');
    },
  });

  static fitted = class Fitted extends Component<typeof Project> {
    <template>
      <div class='project-card compact'>
        <div class='row'>
          <strong>{{if
              @model.projectCode
              @model.projectCode
              'PROJECT'
            }}</strong>
          <span>{{if
              @model.projectStatus
              @model.projectStatus
              'planning'
            }}</span>
        </div>
        <div>{{if
            @model.projectName
            @model.projectName
            'Untitled Project'
          }}</div>
      </div>
      <style scoped>
        .project-card {
          display: grid;
          gap: 0.35rem;
        }
        .compact {
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--card);
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
            <strong>{{if
                @model.projectCode
                @model.projectCode
                'PROJECT'
              }}</strong>
            <span>{{if
                @model.projectStatus
                @model.projectStatus
                'planning'
              }}</span>
          </div>
          <h1>{{if
              @model.projectName
              @model.projectName
              'Untitled Project'
            }}</h1>
        </header>
        {{#if @model.objective}}
          <section>
            <h2>Objective</h2>
            <p>{{@model.objective}}</p>
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
        {{#if @model.tickets.length}}
          <section>
            <h2>Tickets</h2>
            <@fields.tickets />
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

export class DarkFactory extends CardDef {
  static displayName = 'Dark Factory';

  @field factoryName = contains(StringField);
  @field description = contains(MarkdownField);
  @field activeProjects = linksToMany(() => Project);

  @field title = contains(StringField, {
    computeVia: function (this: DarkFactory) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.factoryName ?? 'Dark Factory');
    },
  });

  static fitted = class Fitted extends Component<typeof DarkFactory> {
    <template>
      <div class='compact'>
        <strong>{{if
            @model.factoryName
            @model.factoryName
            'Dark Factory'
          }}</strong>
      </div>
      <style scoped>
        .compact {
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--card);
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof DarkFactory> {
    <template>
      <article class='surface'>
        <h1>{{if @model.factoryName @model.factoryName 'Dark Factory'}}</h1>
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
