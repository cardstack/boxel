// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ UI file: all Component templates — imports schemas, adds fitted/embedded/isolated views

import { Component } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn, concat } from '@ember/helper';
import { eq, gt, and, not } from '@cardstack/boxel-ui/helpers';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';

import {
  AgentProfile,
  KnowledgeArticle,
  Ticket,
  Project as ProjectSchema,
  DarkFactory,
} from './darkfactory-schema';

// ² AgentProfile UI
AgentProfile.fitted = class Fitted extends Component<typeof AgentProfile> {
  <template>
    <div class='agent-fitted'>
      <div class='agent-icon'>🤖</div>
      <div class='agent-info'>
        <div class='agent-name'>{{if
            @model.agentId
            @model.agentId
            'Unknown Agent'
          }}</div>
        {{#if @model.specialization}}
          <div class='agent-spec'>{{@model.specialization}}</div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .agent-fitted {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        height: 100%;
        background: var(--card);
        color: var(--card-foreground);
        font-family: var(--font-mono);
      }
      .agent-icon {
        font-size: 1.25rem;
      }
      .agent-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .agent-spec {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
};

AgentProfile.embedded = class Embedded extends Component<typeof AgentProfile> {
  <template>
    <div class='agent-embedded'>
      <span class='agent-icon'>🤖</span>
      <div class='agent-details'>
        <span class='agent-name'>{{if
            @model.agentId
            @model.agentId
            'Unknown Agent'
          }}</span>
        {{#if @model.specialization}}
          <span class='agent-spec'>{{@model.specialization}}</span>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .agent-embedded {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--card);
        color: var(--card-foreground);
        border-radius: var(--boxel-border-radius-sm);
        border: 1px solid var(--border);
        font-family: var(--font-mono);
      }
      .agent-icon {
        font-size: 1rem;
      }
      .agent-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .agent-spec {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        margin-left: var(--boxel-sp-xs);
      }
    </style>
  </template>
};

AgentProfile.isolated = class Isolated extends Component<typeof AgentProfile> {
  <template>
    <div class='agent-isolated'>
      <div class='agent-header'>
        <div class='agent-avatar'>🤖</div>
        <div class='agent-meta'>
          <h1 class='agent-id'>{{if
              @model.agentId
              @model.agentId
              'Unknown Agent'
            }}</h1>
          {{#if @model.specialization}}<p
              class='agent-spec'
            >{{@model.specialization}}</p>{{/if}}
        </div>
      </div>
      {{#if @model.capabilities.length}}
        <div class='section'>
          <h3 class='section-title'>Capabilities</h3>
          <div class='capabilities'>
            {{#each @model.capabilities as |cap|}}<span
                class='capability-tag'
              >{{cap}}</span>{{/each}}
          </div>
        </div>
      {{/if}}
      {{#if @model.notes}}
        <div class='section'>
          <h3 class='section-title'>Notes</h3>
          <div class='notes'><@fields.notes /></div>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .agent-isolated {
        padding: var(--boxel-sp-xl);
        background: var(--card);
        color: var(--card-foreground);
        font-family: var(--font-mono);
        min-height: 100%;
      }
      .agent-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-lg);
        margin-bottom: var(--boxel-sp-xl);
        padding-bottom: var(--boxel-sp-lg);
        border-bottom: 2px solid var(--primary);
      }
      .agent-avatar {
        font-size: 3rem;
      }
      .agent-id {
        font-size: var(--boxel-font-size-xl);
        font-weight: 700;
        margin: 0;
      }
      .agent-spec {
        color: var(--muted-foreground);
        margin: var(--boxel-sp-xs) 0 0;
      }
      .section {
        margin-top: var(--boxel-sp-lg);
      }
      .section-title {
        font-size: var(--boxel-font-size-sm);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xl);
        color: var(--muted-foreground);
        margin-bottom: var(--boxel-sp-sm);
      }
      .capabilities {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      .capability-tag {
        padding: 2px var(--boxel-sp-xs);
        background: var(--primary);
        color: var(--primary-foreground);
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>
};

// ³ KnowledgeArticle UI
KnowledgeArticle.fitted = class Fitted extends Component<
  typeof KnowledgeArticle
> {
  get typeLabel() {
    const map: Record<string, string> = {
      architecture: 'ARCH',
      decision: 'ADR',
      runbook: 'RUN',
      context: 'CTX',
      api: 'API',
      onboarding: 'OBD',
    };
    return map[this.args.model?.articleType ?? ''] ?? 'DOC';
  }
  <template>
    <div class='kb-fitted'>
      <div class='kb-type-badge'>{{this.typeLabel}}</div>
      <div class='kb-content'>
        <div class='kb-title'>{{if
            @model.articleTitle
            @model.articleTitle
            'Untitled'
          }}</div>
        {{#if @model.tags.length}}
          <div class='kb-tags'>{{#each @model.tags as |tag|}}<span
                class='tag'
              >{{tag}}</span>{{/each}}</div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .kb-fitted {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        height: 100%;
        background: var(--card);
        color: var(--card-foreground);
        font-family: var(--font-mono);
        overflow: hidden;
      }
      .kb-type-badge {
        flex-shrink: 0;
        padding: 2px 5px;
        background: var(--accent);
        color: var(--accent-foreground);
        border-radius: var(--boxel-border-radius-xs);
        font-size: 0.65rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        border: 1px solid var(--border);
      }
      .kb-title {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .kb-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        margin-top: 3px;
      }
      .tag {
        font-size: 0.6rem;
        padding: 1px 4px;
        background: var(--muted);
        color: var(--muted-foreground);
        border-radius: 3px;
      }
    </style>
  </template>
};

KnowledgeArticle.embedded = class Embedded extends Component<
  typeof KnowledgeArticle
> {
  get typeLabel() {
    const map: Record<string, string> = {
      architecture: 'Architecture',
      decision: 'ADR',
      runbook: 'Runbook',
      context: 'Context',
      api: 'API Ref',
      onboarding: 'Onboarding',
    };
    return map[this.args.model?.articleType ?? ''] ?? 'Document';
  }
  <template>
    <div class='kb-embedded'>
      <span class='kb-type'>{{this.typeLabel}}</span>
      <span class='kb-title'>{{if
          @model.articleTitle
          @model.articleTitle
          'Untitled'
        }}</span>
      {{#if @model.updatedAt}}<span class='kb-date'>{{formatDateTime
            @model.updatedAt
            'MMM D, YYYY'
          }}</span>{{/if}}
    </div>
    <style scoped>
      .kb-embedded {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--card);
        color: var(--card-foreground);
        border-radius: var(--boxel-border-radius-sm);
        border: 1px solid var(--border);
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-sm);
      }
      .kb-type {
        padding: 1px 6px;
        background: var(--accent);
        color: var(--accent-foreground);
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        text-transform: uppercase;
      }
      .kb-title {
        font-weight: 500;
        flex: 1;
      }
      .kb-date {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        margin-left: auto;
      }
    </style>
  </template>
};

KnowledgeArticle.isolated = class Isolated extends Component<
  typeof KnowledgeArticle
> {
  <template>
    <article class='kb-isolated'>
      <header class='kb-header'>
        <div class='kb-meta-row'>
          {{#if @model.articleType}}<span
              class='kb-type-badge'
            ><@fields.articleType /></span>{{/if}}
          {{#if @model.updatedAt}}<span class='kb-date'>Updated:
              {{formatDateTime
                @model.updatedAt
                'MMM D, YYYY HH:mm'
              }}</span>{{/if}}
        </div>
        <h1 class='kb-title'>{{if
            @model.articleTitle
            @model.articleTitle
            'Untitled Article'
          }}</h1>
        {{#if @model.tags.length}}
          <div class='kb-tags'>{{#each @model.tags as |tag|}}<span
                class='tag'
              >{{tag}}</span>{{/each}}</div>
        {{/if}}
        {{#if @model.lastUpdatedBy}}
          <div class='kb-author'>Last updated by:
            <@fields.lastUpdatedBy @format='embedded' /></div>
        {{/if}}
      </header>
      <div class='kb-body'>
        {{#if @model.content}}<@fields.content />{{else}}<p
            class='placeholder'
          >No content yet.</p>{{/if}}
      </div>
    </article>
    <style scoped>
      .kb-isolated {
        padding: var(--boxel-sp-xl);
        max-width: 60rem;
        margin: 0 auto;
        font-family: var(--font-sans);
        background: var(--card);
        color: var(--card-foreground);
        min-height: 100%;
        overflow-y: auto;
      }
      .kb-header {
        border-bottom: 2px solid var(--primary);
        padding-bottom: var(--boxel-sp-lg);
        margin-bottom: var(--boxel-sp-xl);
      }
      .kb-meta-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        margin-bottom: var(--boxel-sp-sm);
      }
      .kb-type-badge {
        padding: 2px 8px;
        background: var(--accent);
        color: var(--accent-foreground);
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        font-family: var(--font-mono);
        text-transform: uppercase;
      }
      .kb-date {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        fontily: var(--font-mono);
      }
      .kb-title {
        font-size: var(--boxel-font-size-xl);
        font-weight: 700;
        margin: var(--boxel-sp-sm) 0;
      }
      .kb-tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp-xs);
      }
      .tag {
        padding: 2px 8px;
        background: var(--muted);
        color: var(--muted-foreground);
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-xs);
        font-family: var(--font-mono);
      }
      .kb-author {
        margin-top: var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }
      .kb-body {
        font-size: var(--boxel-font-size-sm);
        line-height: 1.7;
      }
      .placeholder {
        color: var(--muted-foreground);
        font-style: italic;
      }
    </style>
  </template>
};

// ⁴ Ticket UI
Ticket.fitted = class Fitted extends Component<typeof Ticket> {
  get statusAccent() {
    const map: Record<string, string> = {
      backlog: '#6b7280',
      in_progress: '#3b82f6',
      blocked: '#ef4444',
      review: '#f59e0b',
      done: '#22c55e',
    };
    return map[this.args.model?.status ?? ''] ?? '#6b7280';
  }
  get statusEmoji() {
    const m: Record<string, string> = {
      backlog: '📋',
      in_progress: '⚙️',
      blocked: '🔴',
      review: '👁️',
      done: '✅',
    };
    return m[this.args.model?.status ?? ''] ?? '📋';
  }
  get priorityDot() {
    const m: Record<string, string> = {
      critical: '#ff4444',
      high: '#ff8800',
      medium: '#ffcc00',
      low: '#44ff44',
    };
    return m[this.args.model?.priority ?? ''] ?? '#888888';
  }
  <template>
    <div
      class='ticket-fitted'
      style={{if
        @model.status
        (concat '--status-accent:' this.statusAccent)
        '--status-accent:#6b7280'
      }}
    >
      <div class='ticket-top'>
        <span class='ticket-id'>{{if
            @model.ticketId
            @model.ticketId
            '---'
          }}</span>
        <span class='status-emoji'>{{this.statusEmoji}}</span>
        <span
          class='priority-dot'
          style={{concat 'background:' this.priorityDot}}
        ></span>
      </div>
      <div class='ticket-summary'>{{if
          @model.summary
          @model.summary
          'No summary'
        }}</div>
      {{#if @model.assignedAgent}}<div class='ticket-agent'>🤖
          <@fields.assignedAgent @format='atom' /></div>{{/if}}
    </div>
    <style scoped>
      .ticket-fitted {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: var(--boxel-sp-xs) var(--boxel-sp-xs) var(--boxel-sp-xs)
          calc(var(--boxel-sp-xs) + 3px);
        height: 100%;
        background: var(--card);
        color: var(--card-foreground);
        font-family: var(--font-mono);
        overflow: hidden;
        border: 1px solid var(--border);
        border-left: 3px solid var(--status-accent, #6b7280);
        border-radius: var(--boxel-border-radius-sm);
      }
      .ticket-top {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .ticket-id {
        font-size: 0.65rem;
        color: var(--muted-foreground);
        font-weight: 700;
      }
      .status-emoji {
        font-size: 0.75rem;
        margin-left: auto;
      }
      .priority-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .ticket-summary {
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-height: 1.3;
        color: var(--card-foreground);
      }
      .ticket-agent {
        font-size: 0.6rem;
        color: var(--muted-foreground);
        margin-top: auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
};

Ticket.embedded = class Embedded extends Component<typeof Ticket> {
  get statusEmoji() {
    const m: Record<string, string> = {
      backlog: '📋',
      in_progress: '⚙️',
      blocked: '🔴',
      review: '👁️',
      done: '✅',
    };
    return m[this.args.model?.status ?? ''] ?? '📋';
  }
  get priorityDot() {
    const m: Record<string, string> = {
      critical: '#ff4444',
      high: '#ff8800',
      medium: '#ffcc00',
      low: '#44ff44',
    };
    return m[this.args.model?.priority ?? ''] ?? '#888888';
  }
  <template>
    <div class='ticket-embedded'>
      <span
        class='priority-dot'
        style={{concat 'background:' this.priorityDot}}
      ></span>
      <span class='status-emoji'>{{this.statusEmoji}}</span>
      <span class='ticket-id'>{{if
          @model.ticketId
          @model.ticketId
          '---'
        }}</span>
      <span class='ticket-summary'>{{if
          @model.summary
          @model.summary
          'No summary'
        }}</span>
      {{#if @model.assignedAgent}}<span class='ticket-agent'>🤖
          <@fields.assignedAgent @format='atom' /></span>{{/if}}
    </div>
    <style scoped>
      .ticket-embedded {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--card);
        color: var(--card-foreground);
        border-radius: var(--boxel-border-radius-sm);
        border: 1px solid var(--border);
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-sm);
      }
      .priority-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .status-emoji {
        font-size: 0.9rem;
      }
      .ticket-id {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        font-weight: 700;
      }
      .ticket-summary {
        flex: 1;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ticket-agent {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        margin-left: auto;
        white-space: nowrap;
      }
    </style>
  </template>
};

Ticket.isolated = class Isolated extends Component<typeof Ticket> {
  @tracked activeTab: 'overview' | 'context' | 'related' = 'overview';
  setTab = (tab: 'overview' | 'context' | 'related') => {
    this.activeTab = tab;
  };
  get statusEmoji() {
    const m: Record<string, string> = {
      backlog: '📋',
      in_progress: '⚙️',
      blocked: '🔴',
      review: '👁️',
      done: '✅',
    };
    return m[this.args.model?.status ?? ''] ?? '📋';
  }
  get priorityColor() {
    const m: Record<string, string> = {
      critical: '#ff4444',
      high: '#ff8800',
      medium: '#ffcc00',
      low: '#44ff44',
    };
    return m[this.args.model?.priority ?? ''] ?? '#888888';
  }
  <template>
    <div class='ticket-isolated'>
      <header class='ticket-header'>
        <div class='ticket-meta-row'>
          <span class='ticket-id-badge'>{{if
              @model.ticketId
              @model.ticketId
              'NO-ID'
            }}</span>
          {{#if @model.ticketType}}<span class='type-badge'><@fields.ticketType
              /></span>{{/if}}
          <div class='header-right'>
            {{#if @model.status}}<span
                class='status-indicator'
              >{{this.statusEmoji}} <@fields.status /></span>{{/if}}
            {{#if @model.priority}}<span
                class='priority-indicator'
                style={{concat 'border-color:' this.priorityColor}}
              ><@fields.priority /></span>{{/if}}
          </div>
        </div>
        <h1 class='ticket-title'>{{if
            @model.summary
            @model.summary
            'Untitled Ticket'
          }}</h1>
        <div class='ticket-agents-row'>
          {{#if @model.assignedAgent}}
            <span class='label'>Assigned:</span>
            <@fields.assignedAgent @format='embedded' />
          {{else}}
            <span class='unassigned'>⚡ Unassigned</span>
          {{/if}}
          {{#if @model.estimatedHours}}<span class='hours-badge'>Est.
              {{@model.estimatedHours}}h</span>{{/if}}
          {{#if @model.actualHours}}<span class='hours-badge actual'>Act.
              {{@model.actualHours}}h</span>{{/if}}
        </div>
      </header>
      <nav class='ticket-tabs'>
        <button
          class={{if (eq this.activeTab 'overview') 'tab active' 'tab'}}
          {{on 'click' (fn this.setTab 'overview')}}
        >Overview</button>
        <button
          class={{if (eq this.activeTab 'context') 'tab active' 'tab'}}
          {{on 'click' (fn this.setTab 'context')}}
        >Agent Context</button>
        <button
          class={{if (eq this.activeTab 'related') 'tab active' 'tab'}}
          {{on 'click' (fn this.setTab 'related')}}
        >Related</button>
      </nav>
      {{#if (eq this.activeTab 'overview')}}
        <section class='ticket-body'>
          <div class='section'>
            <h3 class='section-title'>Description</h3>
            {{#if @model.description}}<div
                class='markdown-content'
              ><@fields.description /></div>{{else}}<p class='placeholder'>No
                description provided.</p>{{/if}}
          </div>
          {{#if @model.acceptanceCriteria}}
            <div class='section'>
              <h3 class='section-title'>Acceptance Criteria</h3>
              <div class='markdown-content'><@fields.acceptanceCriteria /></div>
            </div>
          {{/if}}
        </section>
      {{/if}}
      {{#if (eq this.activeTab 'context')}}
        <section class='ticket-body'>
          <div class='section'>
            <h3 class='section-title'>Agent Notes</h3>
            {{#if @model.agentNotes}}<div
                class='markdown-content'
              ><@fields.agentNotes /></div>{{else}}<p class='placeholder'>No
                agent notes yet. Document findings, decisions, and progress
                here.</p>{{/if}}
          </div>
        </section>
      {{/if}}
      {{#if (eq this.activeTab 'related')}}
        <section class='ticket-body'>
          {{#if @model.relatedTickets.length}}
            <div class='section'>
              <h3 class='section-title'>Related Tickets</h3>
              <div class='related-list'><@fields.relatedTickets
                  @format='embedded'
                /></div>
            </div>
          {{/if}}
          {{#if @model.relatedKnowledge.length}}
            <div class='section'>
              <h3 class='section-title'>Knowledge Articles</h3>
              <div class='related-list'><@fields.relatedKnowledge
                  @format='embedded'
                /></div>
            </div>
          {{/if}}
          {{#if
            (and
              (not @model.relatedTickets.length)
              (not @model.relatedKnowledge.length)
            )
          }}
            <p class='placeholder'>No related items linked yet.</p>
          {{/if}}
        </section>
      {{/if}}
      {{#if @model.updatedAt}}
        <footer class='ticket-footer'>Last updated:
          {{formatDateTime @model.updatedAt 'MMM D, YYYY HH:mm'}}</footer>
      {{/if}}
    </div>
    <style scoped>
      .ticket-isolated {
        display: flex;
        flex-direction: column;
        min-height: 100%;
        background: var(--card);
        color: var(--card-foreground);
        font-family: var(--font-mono);
        overflow-y: auto;
      }
      .ticket-header {
        padding: var(--boxel-sp-xl);
        background: var(--muted);
        border-bottom: 2px solid var(--primary);
      }
      .ticket-meta-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-sm);
        flex-wrap: wrap;
      }
      .header-right {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-left: auto;
      }
      .ticket-id-badge {
        padding: 2px 8px;
        background: var(--primary);
        color: var(--primary-foreground);
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
      }
      .type-badge {
        padding: 2px 8px;
        background: var(--secondary);
        color: var(--secondary-foreground);
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
      }
      .status-indicator {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: var(--muted);
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-xs);
      }
      .priority-indicator {
        padding: 2px 8px;
        border: 1px solid;
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-xs);
      }
      .ticket-title {
        font-size: var(--boxel-font-size-xl);
        font-weight: 700;
        margin: var(--boxel-sp-sm) 0;
        font-family: var(--font-sans);
        color: var(--foreground);
      }
      .ticket-agents-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        flex-wrap: wrap;
      }
      .label {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .unassigned {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        font-style: italic;
      }
      .hours-badge {
        padding: 2px 6px;
        background: var(--muted);
        color: var(--muted-foreground);
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-xs);
      }
      .hours-badge.actual {
        background: var(--accent);
        color: var(--accent-foreground);
      }
      .ticket-tabs {
        display: flex;
        padding: 0 var(--boxel-sp-xl);
        background: var(--card);
        border-bottom: 1px solid var(--border);
        gap: 2px;
      }
      .tab {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--muted-foreground);
        cursor: pointer;
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-sm);
        transition: color 0.15s;
        margin-bottom: -1px;
      }
      .tab:hover {
        color: var(--foreground);
      }
      .tab.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
      }
      .ticket-body {
        padding: var(--boxel-sp-xl);
        flex: 1;
      }
      .section {
        margin-bottom: var(--boxel-sp-xl);
      }
      .section-title {
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xl);
        color: var(--muted-foreground);
        margin-bottom: var(--boxel-sp-sm);
      }
      .markdown-content {
        font-family: var(--font-sans);
        font-size: var(--boxel-font-size-sm);
        line-height: 1.7;
        color: var(--card-foreground);
      }
      .related-list {
        display: flex;
        flex-direction: column;
      }
      .related-list > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .placeholder {
        color: var(--muted-foreground);
        font-style: italic;
        font-size: var(--boxel-font-size-sm);
      }
      .ticket-footer {
        padding: var(--boxel-sp-sm) var(--boxel-sp-xl);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        border-top: 1px solid var(--border);
        text-align: right;
      }
    </style>
  </template>
};

export class Project extends ProjectSchema {

static fitted = class Fitted extends Component<typeof ProjectSchema> {
  get statusAccent() {
    const m: Record<string, string> = {
      planning: '#f59e0b',
      active: '#22c55e',
      on_hold: '#6b7280',
      completed: '#3b82f6',
      archived: '#9ca3af',
    };
    return m[this.args.model?.projectStatus ?? ''] ?? '#6b7280';
  }
  get statusEmoji() {
    const m: Record<string, string> = {
      planning: '🗺️',
      active: '⚡',
      on_hold: '⏸️',
      completed: '🎯',
      archived: '📦',
    };
    return m[this.args.model?.projectStatus ?? ''] ?? '📁';
  }
  get daysUntilDeadline() {
    try {
      if (!this.args.model?.deadline) return null;
      const days = Math.ceil(
        (new Date(this.args.model.deadline).getTime() - Date.now()) / 86400000,
      );
      return days;
    } catch {
      return null;
    }
  }
  <template>
    <div
      class='project-fitted'
      style={{concat '--status-accent:' this.statusAccent}}
    >
      <div class='project-header'>
        <span class='project-code'>{{if
            @model.projectCode
            @model.projectCode
            'PRJ'
          }}</span>
        <span class='status-emoji'>{{this.statusEmoji}}</span>
      </div>
      <div class='project-name'>{{if
          @model.projectName
          @model.projectName
          'Unnamed Project'
        }}</div>
      <div class='project-stats'>
        <span class='stat'>🎫 {{@model.tickets.length}}</span>
        <span class='stat'>📚 {{@model.knowledgeBase.length}}</span>
        {{#if this.daysUntilDeadline}}<span class='stat deadline'>⏱
            {{this.daysUntilDeadline}}d</span>{{/if}}
      </div>
    </div>
    <style scoped>
      .project-fitted {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: var(--boxel-sp-xs) var(--boxel-sp-xs) var(--boxel-sp-xs)
          calc(var(--boxel-sp-xs) + 3px);
        height: 100%;
        background: var(--card);
        color: var(--card-foreground);
        font-family: var(--font-mono);
        overflow: hidden;
        border: 1px solid var(--border);
        border-left: 3px solid var(--status-accent, #22c55e);
        border-radius: var(--boxel-border-radius-sm);
      }
      .project-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .project-code {
        font-size: 0.65rem;
        font-weight: 700;
        color: var(--muted-foreground);
      }
      .status-emoji {
        font-size: 0.9rem;
      }
      .project-name {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--card-foreground);
      }
      .project-stats {
        display: flex;
        gap: var(--boxel-sp-xs);
        margin-top: auto;
      }
      .stat {
        font-size: 0.6rem;
        color: var(--muted-foreground);
      }
      .deadline {
        color: var(--destructive);
      }
    </style>
  </template>
};

static embedded = class Embedded extends Component<typeof ProjectSchema> {
  get statusEmoji() {
    const m: Record<string, string> = {
      planning: '🗺️',
      active: '⚡',
      on_hold: '⏸️',
      completed: '🎯',
      archived: '📦',
    };
    return m[this.args.model?.projectStatus ?? ''] ?? '📁';
  }
  <template>
    <div class='project-embedded'>
      <span class='project-code'>{{if
          @model.projectCode
          @model.projectCode
          'PRJ'
        }}</span>
      <span class='status-emoji'>{{this.statusEmoji}}</span>
      <span class='project-name'>{{if
          @model.projectName
          @model.projectName
          'Unnamed Project'
        }}</span>
      <div class='project-stats'>
        <span class='stat'>🎫 {{@model.tickets.length}} tickets</span>
        <span class='stat'>📚 {{@model.knowledgeBase.length}} docs</span>
      </div>
    </div>
    <style scoped>
      .project-embedded {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--card);
        color: var(--card-foreground);
        border-radius: var(--boxel-border-radius-sm);
        border: 1px solid var(--border);
        font-family: var(--font-mono);
      }
      .project-code {
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        color: var(--muted-foreground);
      }
      .status-emoji {
        font-size: 1rem;
      }
      .project-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        flex: 1;
      }
      .project-stats {
        display: flex;
        gap: var(--boxel-sp-xs);
        margin-left: auto;
      }
      .stat {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
    </style>
  </template>
};


  static isolated = class Isolated extends Component<typeof ProjectSchema> {
  @tracked activeTab: 'dashboard' | 'tickets' | 'knowledge' | 'scope' | 'team' =
    'dashboard';
  setTab = (tab: typeof this.activeTab) => {
    this.activeTab = tab;
  };
  get statusEmoji() {
    const m: Record<string, string> = {
      planning: '🗺️',
      active: '⚡',
      on_hold: '⏸️',
      completed: '🎯',
      archived: '📦',
    };
    return m[this.args.model?.projectStatus ?? ''] ?? '📁';
  }
  get daysUntilDeadline() {
    try {
      if (!this.args.model?.deadline) return null;
      return Math.ceil(
        (new Date(this.args.model.deadline).getTime() - Date.now()) / 86400000,
      );
    } catch {
      return null;
    }
  }
  get deadlineColor() {
    const d = this.daysUntilDeadline;
    if (d === null) return 'var(--muted-foreground)';
    if (d < 0) return '#ff4444';
    if (d <= 3) return '#ff8800';
    if (d <= 7) return '#ffcc00';
    return '#44ff44';
  }
  get ticketsByStatus() {
    try {
      const tickets = this.args.model?.tickets ?? [];
      const groups: Record<string, number> = {
        backlog: 0,
        in_progress: 0,
        blocked: 0,
        review: 0,
        done: 0,
      };
      for (const t of tickets) {
        const s = t.status ?? 'backlog';
        if (s in groups) groups[s]++;
      }
      return groups;
    } catch {
      return { backlog: 0, in_progress: 0, blocked: 0, review: 0, done: 0 };
    }
  }
  get totalTickets() {
    return this.args.model?.tickets?.length ?? 0;
  }
  get completionPercent() {
    const total = this.totalTickets;
    return total === 0
      ? 0
      : Math.round((this.ticketsByStatus.done / total) * 100);
  }
  get progressBarWidth() {
    return `${this.completionPercent}%`;
  }

  <template>
    <div class='project-isolated'>
      <header class='project-header'>
        <div class='project-header-top'>
          <div class='project-identity'>
            <span class='project-code-large'>{{if
                @model.projectCode
                @model.projectCode
                'PRJ'
              }}</span>
            <div class='status-pill'>
              {{this.statusEmoji}}
              {{#if @model.projectStatus}}<@fields.projectStatus />{{else}}<span
                >Unknown</span>{{/if}}
            </div>
          </div>
          <div class='deadline-section'>
            {{#if @model.deadline}}
              <div class='deadline-label'>DEADLINE</div>
              <div
                class='deadline-value'
                style={{concat 'color:' this.deadlineColor}}
              >
                {{formatDateTime @model.deadline 'MMM D, YYYY'}}
                {{#if this.daysUntilDeadline}}
                  <span class='days-remaining'>
                    {{#if
                      (gt this.daysUntilDeadline 0)
                    }}({{this.daysUntilDeadline}}d remaining){{else}}(OVERDUE by
                      {{this.daysUntilDeadline}}
                      days){{/if}}
                  </span>
                {{/if}}
              </div>
            {{else}}
              <div class='deadline-label'>No deadline set</div>
            {{/if}}
          </div>
        </div>
        <h1 class='project-name'>{{if
            @model.projectName
            @model.projectName
            'Unnamed Project'
          }}</h1>
        {{#if @model.objective}}<p
            class='project-objective'
          >{{@model.objective}}</p>{{/if}}
        <div class='progress-section'>
          <div class='progress-bar-track'>
            <div
              class='progress-bar-fill'
              style={{concat 'width:' this.progressBarWidth}}
            ></div>
          </div>
          <span class='progress-label'>{{this.completionPercent}}% complete ({{this.ticketsByStatus.done}}/{{this.totalTickets}}
            tickets done)</span>
        </div>
      </header>

      <nav class='project-tabs'>
        <button
          class={{if (eq this.activeTab 'dashboard') 'tab active' 'tab'}}
          {{on 'click' (fn this.setTab 'dashboard')}}
        >📊 Dashboard</button>
        <button
          class={{if (eq this.activeTab 'tickets') 'tab active' 'tab'}}
          {{on 'click' (fn this.setTab 'tickets')}}
        >🎫 Tickets ({{this.totalTickets}})</button>
        <button
          class={{if (eq this.activeTab 'knowledge') 'tab active' 'tab'}}
          {{on 'click' (fn this.setTab 'knowledge')}}
        >📚 Knowledge ({{@model.knowledgeBase.length}})</button>
        <button
          class={{if (eq this.activeTab 'scope') 'tab active' 'tab'}}
          {{on 'click' (fn this.setTab 'scope')}}
        >🗂️ Scope</button>
        <button
          class={{if (eq this.activeTab 'team') 'tab active' 'tab'}}
          {{on 'click' (fn this.setTab 'team')}}
        >🤖 Team ({{@model.teamAgents.length}})</button>
      </nav>

      {{#if (eq this.activeTab 'dashboard')}}
        <section class='tab-content'>
          <div class='status-grid'>
            <div class='status-card backlog'><div
                class='status-count'
              >{{this.ticketsByStatus.backlog}}</div><div class='status-name'>📋
                Backlog</div></div>
            <div class='status-card in-progress'><div
                class='status-count'
              >{{this.ticketsByStatus.in_progress}}</div><div
                class='status-name'
              >⚙️ In Progress</div></div>
            <div class='status-card blocked'><div
                class='status-count'
              >{{this.ticketsByStatus.blocked}}</div><div class='status-name'>🔴
                Blocked</div></div>
            <div class='status-card review'><div
                class='status-count'
              >{{this.ticketsByStatus.review}}</div><div class='status-name'>👁️
                Review</div></div>
            <div class='status-card done'><div
                class='status-count'
              >{{this.ticketsByStatus.done}}</div><div class='status-name'>✅
                Done</div></div>
          </div>
          <div class='info-panels'>
            {{#if @model.teamAgents.length}}
              <div class='info-panel'><h3 class='panel-title'>Active Agents</h3><div
                  class='agents-list'
                ><@fields.teamAgents @format='embedded' /></div></div>
            {{/if}}
            {{#if @model.risks}}
              <div class='info-panel risk-panel'><h3 class='panel-title'>⚠️
                  Risks</h3><div class='panel-content'><@fields.risks
                  /></div></div>
            {{/if}}
            {{#if @model.successCriteria}}
              <div class='info-panel success-panel'><h3 class='panel-title'>🎯
                  Success Criteria</h3><div
                  class='panel-content'
                ><@fields.successCriteria /></div></div>
            {{/if}}
          </div>
        </section>
      {{/if}}

      {{#if (eq this.activeTab 'tickets')}}
        <section class='tab-content'>
          {{#if @model.tickets.length}}
            <div class='tickets-grid'><@fields.tickets @format='fitted' /></div>
          {{else}}
            <div class='empty-state'><div class='empty-icon'>🎫</div><p>No
                tickets yet. Create tickets to track work items.</p></div>
          {{/if}}
        </section>
      {{/if}}

      {{#if (eq this.activeTab 'knowledge')}}
        <section class='tab-content'>
          {{#if @model.knowledgeBase.length}}
            <div class='knowledge-list'><@fields.knowledgeBase
                @format='embedded'
              /></div>
          {{else}}
            <div class='empty-state'><div class='empty-icon'>📚</div><p>No
                knowledge articles yet.</p></div>
          {{/if}}
        </section>
      {{/if}}

      {{#if (eq this.activeTab 'scope')}}
        <section class='tab-content'>
          <div class='scope-section'>
            <h3 class='section-title'>Project Scope</h3>
            {{#if @model.scope}}<div class='markdown-content'><@fields.scope
                /></div>{{else}}<p class='placeholder'>Define the project scope
                here.</p>{{/if}}
          </div>
          {{#if @model.technicalContext}}
            <div class='scope-section'><h3 class='section-title'>Technical
                Context</h3><div
                class='markdown-content'
              ><@fields.technicalContext /></div></div>
          {{/if}}
        </section>
      {{/if}}

      {{#if (eq this.activeTab 'team')}}
        <section class='tab-content'>
          {{#if @model.teamAgents.length}}
            <div class='team-grid'><@fields.teamAgents @format='fitted' /></div>
          {{else}}
            <div class='empty-state'><div class='empty-icon'>🤖</div><p>No
                agents assigned yet.</p></div>
          {{/if}}
        </section>
      {{/if}}
    </div>

    <style scoped>
      .project-isolated {
        display: flex;
        flex-direction: column;
        min-height: 100%;
        background: var(--background);
        color: var(--foreground);
        font-family: var(--font-mono);
        overflow-y: auto;
      }
      .project-header {
        padding: var(--boxel-sp-xl);
        background: var(--card);
        border-bottom: 2px solid var(--primary);
      }
      .project-header-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: var(--boxel-sp-sm);
        flex-wrap: wrap;
        gap: var(--boxel-sp-sm);
      }
      .project-identity {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .project-code-large {
        padding: 3px 10px;
        background: var(--primary);
        color: var(--primary-foreground);
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        letter-spacing: 0.1em;
      }
      .status-pill {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 3px 10px;
        background: var(--muted);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-sm);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .deadline-section {
        text-align: right;
      }
      .deadline-label {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .deadline-value {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        margin-top: 2px;
      }
      .days-remaining {
        font-size: var(--boxel-font-size-xs);
        opacity: 0.8;
      }
      .project-name {
        font-size: clamp(1.25rem, 3vw, 1.75rem);
        font-weight: 700;
        font-family: var(--font-sans);
        color: var(--foreground);
        margin: var(--boxel-sp-sm) 0;
      }
      .project-objective {
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
        font-family: var(--font-sans);
        line-height: 1.5;
        margin-bottom: var(--boxel-sp-sm);
      }
      .progress-section {
        margin-top: var(--boxel-sp-sm);
      }
      .progress-bar-track {
        width: 100%;
        height: 6px;
        background: var(--muted);
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 4px;
      }
      .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--primary), var(--accent));
        border-radius: 3px;
        transition: width 0.3s ease;
      }
      .progress-label {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .project-tabs {
        display: flex;
        padding: 0 var(--boxel-sp-xl);
        background: var(--card);
        border-bottom: 1px solid var(--border);
        gap: 2px;
        overflow-x: auto;
      }
      .tab {
        flex-shrink: 0;
        padding: var(--boxel-sp-sm);
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--muted-foreground);
        cursor: pointer;
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-xs);
        transition: color 0.15s;
        margin-bottom: -1px;
        white-space: nowrap;
      }
      .tab:hover {
        color: var(--foreground);
      }
      .tab.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
      }
      .tab-content {
        padding: var(--boxel-sp-xl);
      }
      .status-grid {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: var(--boxel-sp-sm);
        margin-bottom: var(--boxel-sp-xl);
      }
      @media (max-width: 700px) {
        .status-grid {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      .status-card {
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius-sm);
        border: 1px solid var(--border);
        text-align: center;
        border-top: 3px solid var(--border);
      }
      .status-card.backlog {
        background: var(--muted);
        border-top-color: #6b7280;
      }
      .status-card.in-progress {
        background: var(--muted);
        border-top-color: #3b82f6;
      }
      .status-card.blocked {
        background: var(--muted);
        border-top-color: #ef4444;
      }
      .status-card.review {
        background: var(--muted);
        border-top-color: #f59e0b;
      }
      .status-card.done {
        background: var(--muted);
        border-top-color: #22c55e;
      }
      .status-count {
        font-size: 1.75rem;
        font-weight: 700;
        color: var(--foreground);
        font-family: var(--font-sans);
      }
      .status-name {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        margin-top: 2px;
      }
      .info-panels {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: var(--boxel-sp-lg);
      }
      .info-panel {
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-sm);
        background: var(--card);
      }
      .risk-panel {
        border-top: 3px solid #ef4444;
      }
      .success-panel {
        border-top: 3px solid #22c55e;
      }
      .panel-title {
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xl);
        color: var(--muted-foreground);
        margin-bottom: var(--boxel-sp-sm);
      }
      .panel-content {
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
        font-family: var(--font-sans);
      }
      .agents-list {
        display: flex;
        flex-direction: column;
      }
      .agents-list > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .tickets-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--boxel-sp-sm);
      }
      .tickets-grid > .containsMany-field {
        display: contents;
      }
      .knowledge-list {
        display: flex;
        flex-direction: column;
      }
      .knowledge-list > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .team-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--boxel-sp-sm);
        min-height: 120px;
      }
      .team-grid > .containsMany-field {
        display: contents;
      }
      .scope-section {
        margin-bottom: var(--boxel-sp-xl);
      }
      .section-title {
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xl);
        color: var(--muted-foreground);
        margin-bottom: var(--boxel-sp-sm);
      }
      .markdown-content {
        font-family: var(--font-sans);
        font-size: var(--boxel-font-size-sm);
        line-height: 1.7;
      }
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--boxel-sp-3xl);
        color: var(--muted-foreground);
        text-align: center;
        gap: var(--boxel-sp-sm);
      }
      .empty-icon {
        font-size: 3rem;
      }
      .placeholder {
        color: var(--muted-foreground);
        font-style: italic;
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
};
}
// ⁶ DarkFactory UI
DarkFactory.fitted = class Fitted extends Component<typeof DarkFactory> {
  <template>
    <div class='factory-fitted'>
      <div class='factory-icon'>🏭</div>
      <div class='factory-info'>
        <div class='factory-name'>{{if
            @model.factoryName
            @model.factoryName
            'Dark Factory'
          }}</div>
        <div class='factory-stat'>{{@model.activeProjects.length}}
          projects</div>
      </div>
    </div>
    <style scoped>
      .factory-fitted {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        height: 100%;
        background: var(--card);
        color: var(--card-foreground);
        font-family: var(--font-mono);
      }
      .factory-icon {
        font-size: 1.5rem;
      }
      .factory-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
      }
      .factory-stat {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
    </style>
  </template>
};

DarkFactory.embedded = class Embedded extends Component<typeof DarkFactory> {
  <template>
    <div class='factory-embedded'>
      <span class='factory-icon'>🏭</span>
      <span class='factory-name'>{{if
          @model.factoryName
          @model.factoryName
          'Dark Factory'
        }}</span>
      <span class='factory-stat'>{{@model.activeProjects.length}}
        projects</span>
    </div>
    <style scoped>
      .factory-embedded {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--card);
        color: var(--card-foreground);
        border-radius: var(--boxel-border-radius-sm);
        border: 1px solid var(--border);
        font-family: var(--font-mono);
      }
      .factory-icon {
        font-size: 1rem;
      }
      .factory-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        flex: 1;
      }
      .factory-stat {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
    </style>
  </template>
};

DarkFactory.isolated = class Isolated extends Component<typeof DarkFactory> {
  <template>
    <div class='factory-isolated'>
      <header class='factory-header'>
        <div class='factory-title-row'>
          <span class='factory-glyph'>🏭</span>
          <h1>{{if @model.factoryName @model.factoryName 'Dark Factory'}}</h1>
        </div>
        <p class='factory-subtitle'>Agent-Operated Software Factory</p>
      </header>
      {{#if @model.description}}<div
          class='factory-desc section'
        ><@fields.description /></div>{{/if}}
      {{#if @model.activeProjects.length}}
        <div class='section'>
          <h3 class='section-title'>Active Projects</h3>
          <div class='projects-list'><@fields.activeProjects
              @format='embedded'
            /></div>
        </div>
      {{else}}
        <div class='empty-state'><p>No active projects. Create a Project card to
            get started.</p></div>
      {{/if}}
    </div>
    <style scoped>
      .factory-isolated {
        padding: var(--boxel-sp-xl);
        min-height: 100%;
        background: var(--background);
        color: var(--foreground);
        font-family: var(--font-mono);
        overflow-y: auto;
      }
      .factory-header {
        margin-bottom: var(--boxel-sp-xl);
        padding-bottom: var(--boxel-sp-lg);
        border-bottom: 2px solid var(--primary);
      }
      .factory-title-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .factory-glyph {
        font-size: 2.5rem;
      }
      h1 {
        font-size: var(--boxel-font-size-xl);
        font-weight: 700;
        margin: 0;
        font-family: var(--font-sans);
      }
      .factory-subtitle {
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
        margin-top: var(--boxel-sp-xs);
      }
      .section {
        margin-bottom: var(--boxel-sp-xl);
      }
      .section-title {
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xl);
        color: var(--muted-foreground);
        margin-bottom: var(--boxel-sp-sm);
      }
      .projects-list {
        display: flex;
        flex-direction: column;
      }
      .projects-list > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .empty-state {
        color: var(--muted-foreground);
        font-style: italic;
        font-size: var(--boxel-font-size-sm);
      }
      .factory-desc {
        font-family: var(--font-sans);
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
      }
    </style>
  </template>
};

export { AgentProfile, KnowledgeArticle, Ticket, DarkFactory };
// touched for re-index
