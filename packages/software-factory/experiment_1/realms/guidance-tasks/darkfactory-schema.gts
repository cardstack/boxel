// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ Schema-only file: field definitions, enums, card schemas — no UI templates

import {
  CardDef,
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

// ² Enum field definitions
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

// ³ AgentProfile — schema only
export class AgentProfile extends CardDef {
  static displayName = 'Agent Profile';

  @field agentId = contains(StringField);
  @field capabilities = containsMany(StringField);
  @field specialization = contains(StringField);
  @field notes = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: AgentProfile) {
      return this.agentId ?? 'Unnamed Agent';
    },
  });
}

// ⁴ KnowledgeArticle — schema only
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
      return this.cardInfo?.title ?? this.articleTitle ?? 'Untitled Article';
    },
  });
}

// ⁵ Ticket — schema only
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
      return this.cardInfo?.title ?? this.summary ?? 'Untitled Ticket';
    },
  });
}

// ⁶ Project — schema only
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
          module: new URL('./darkfactory-schema', import.meta.url).href,
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
  @field createdAt = contains(DateTimeField);

  @field title = contains(StringField, {
    computeVia: function (this: Project) {
      return this.cardInfo?.title ?? this.projectName ?? 'Untitled Project';
    },
  });
}

// ⁷ DarkFactory — schema only
export class DarkFactory extends CardDef {
  static displayName = 'Dark Factory';

  @field factoryName = contains(StringField);
  @field description = contains(MarkdownField);
  @field activeProjects = linksToMany(() => Project);

  @field title = contains(StringField, {
    computeVia: function (this: DarkFactory) {
      return this.cardInfo?.title ?? this.factoryName ?? 'Dark Factory';
    },
  });
}
// touched for re-index
