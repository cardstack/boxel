import { Component } from 'https://cardstack.com/base/card-api';

import {
  AgentProfile,
  KnowledgeArticle,
  Ticket,
  Project as ProjectSchema,
  DarkFactory as DarkFactorySchema,
} from './darkfactory-schema';

AgentProfile.fitted = class Fitted extends Component<typeof AgentProfile> {
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

AgentProfile.embedded = AgentProfile.fitted;

AgentProfile.isolated = class Isolated extends Component<typeof AgentProfile> {
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

KnowledgeArticle.fitted = class Fitted extends Component<
  typeof KnowledgeArticle
> {
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

KnowledgeArticle.embedded = KnowledgeArticle.fitted;

KnowledgeArticle.isolated = class Isolated extends Component<
  typeof KnowledgeArticle
> {
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

Ticket.fitted = class Fitted extends Component<typeof Ticket> {
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

Ticket.embedded = Ticket.fitted;

Ticket.isolated = class Isolated extends Component<typeof Ticket> {
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

ProjectSchema.fitted = class Fitted extends Component<typeof ProjectSchema> {
  <template>
    <div class='project-card compact'>
      <div class='row'>
        <strong>{{if @model.projectCode @model.projectCode 'PROJECT'}}</strong>
        <span>{{if @model.projectStatus @model.projectStatus 'planning'}}</span>
      </div>
      <div>{{if @model.projectName @model.projectName 'Untitled Project'}}</div>
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

ProjectSchema.embedded = ProjectSchema.fitted;

ProjectSchema.isolated = class Isolated extends Component<
  typeof ProjectSchema
> {
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
        <h1>{{if @model.projectName @model.projectName 'Untitled Project'}}</h1>
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

DarkFactorySchema.fitted = class Fitted extends Component<
  typeof DarkFactorySchema
> {
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

DarkFactorySchema.embedded = DarkFactorySchema.fitted;

DarkFactorySchema.isolated = class Isolated extends Component<
  typeof DarkFactorySchema
> {
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

export {
  AgentProfile,
  KnowledgeArticle,
  Ticket,
  ProjectSchema as Project,
  DarkFactorySchema as DarkFactory,
};
