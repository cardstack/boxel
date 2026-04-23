import { tracked } from '@glimmer/tracking';
import { fn, get } from '@ember/helper';
import { on } from '@ember/modifier';
import Owner from '@ember/owner';

import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateTimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import TextAreaField from 'https://cardstack.com/base/text-area';
import enumField from 'https://cardstack.com/base/enum';

import SquareKanban from '@cardstack/boxel-icons/square-kanban';

import {
  ContextButton,
  Pill,
  SortDropdown,
  Switch,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

import { realmURL } from '@cardstack/runtime-common';

import { IssueOptionField } from './issue-option';
import {
  KanbanColumnField,
  KanbanPlane,
  KanbanDragManager,
  type KanbanPlacement,
} from './kanban-board';
import { StatusPill } from './status-pill';

interface Option {
  value: string;
  label: string;
  color?: string;
}

const issueCodeRef = {
  // @ts-ignore this is not a CJS file, import.meta is allowed
  module: new URL('./darkfactory', import.meta.url).href,
  name: 'Issue',
};

const issueStatusOptions: Option[] = [
  { value: 'backlog', label: 'Backlog', color: 'var(--boxel-navy)' },
  {
    value: 'in_progress',
    label: 'In Progress',
    color: 'var(--boxel-warning-200)',
  },
  { value: 'blocked', label: 'Blocked', color: 'var(--boxel-red)' },
  { value: 'review', label: 'In Review', color: 'var(--boxel-dark-green)' },
  { value: 'done', label: 'Done', color: 'var(--boxel-purple)' },
];

const issueTypeOptions: Option[] = [
  { value: 'bootstrap', label: 'Bootstrap' },
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'task', label: 'Task' },
  { value: 'research', label: 'Research' },
  { value: 'infrastructure', label: 'Infrastructure' },
];

const issuePriorityOptions: Option[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const projectStatusOptions: Option[] = [
  { value: 'planning', label: 'Planning', color: 'var(--boxel-navy)' },
  { value: 'active', label: 'Active', color: 'var(--boxel-dark-green)' },
  { value: 'on_hold', label: 'On Hold', color: 'var(--boxel-orange)' },
  { value: 'completed', label: 'Completed', color: 'var(--boxel-purple)' },
  { value: 'archived', label: 'Archived', color: 'var(--boxel-500)' },
];

interface Column {
  value: string;
  label: string;
  fieldName: string;
  orderField: string;
  options: Option[];
}

function findOptionColor(
  options: Option[] | undefined,
  value: string | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  return options?.find((option) => option.value === value)?.color;
}

function buildIssueOptionFields(options: Option[]): IssueOptionField[] {
  return options.map((option) => new IssueOptionField(option));
}

function buildColumnConfig(options: Option[]): KanbanColumnField[] {
  return options.map(
    (option, index) =>
      new KanbanColumnField({
        key: option.value,
        label: option.label,
        color: option.color,
        sortOrder: index,
      }),
  );
}

const defaultColumns: Column[] = [
  {
    value: 'status',
    label: 'Status',
    fieldName: 'status',
    orderField: 'statusBoardOrder',
    options: issueStatusOptions,
  },
  {
    value: 'priority',
    label: 'Priority',
    fieldName: 'priority',
    orderField: 'priorityBoardOrder',
    options: issuePriorityOptions,
  },
  {
    value: 'issueType',
    label: 'Type',
    fieldName: 'issueType',
    orderField: 'issueTypeBoardOrder',
    options: issueTypeOptions,
  },
];

const IssueStatusField = enumField(StringField, {
  options: function (this: any) {
    const opts = this.kanbanBoard?.issueStatusOptions;
    return opts?.length ? opts : issueStatusOptions;
  },
});

const IssueTypeField = enumField(StringField, {
  options: function (this: any) {
    const opts = this.kanbanBoard?.issueTypeOptions;
    return opts?.length ? opts : issueTypeOptions;
  },
});

const IssuePriorityField = enumField(StringField, {
  options: function (this: any) {
    const opts = this.kanbanBoard?.issuePriorityOptions;
    return opts?.length ? opts : issuePriorityOptions;
  },
});

const ProjectStatusField = enumField(StringField, {
  options: projectStatusOptions,
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

  @field cardTitle = contains(StringField, {
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

  @field cardTitle = contains(StringField, {
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

export class Comment extends FieldDef {
  static displayName = 'Comment';
  @field body = contains(MarkdownField);
  @field author = contains(StringField);
  @field datetime = contains(DateTimeField);

  static embedded = class Embedded extends Component<typeof Comment> {
    <template>
      <div class='comment'>
        <div class='comment-header'>
          <span class='comment-author'>{{@model.author}}</span>
          {{#if @model.datetime}}
            <span class='comment-date'><@fields.datetime /></span>
          {{/if}}
        </div>
        <div class='comment-body'>
          <@fields.body />
        </div>
      </div>
      <style scoped>
        .comment {
          padding: 12px 0;
          border-bottom: 1px solid var(--boxel-200);
        }
        .comment:last-child {
          border-bottom: none;
        }
        .comment-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }
        .comment-author {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
        }
        .comment-date {
          color: var(--boxel-400);
          font-size: var(--boxel-font-size-xs);
        }
        .comment-body {
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };
}

export class Issue extends CardDef {
  static displayName = 'Issue';

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
  @field kanbanBoard = linksTo(() => CardDef);
  @field statusBoardOrder = contains(NumberField);
  @field priorityBoardOrder = contains(NumberField);
  @field issueTypeBoardOrder = contains(NumberField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Issue) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.summary ?? 'Untitled Issue');
    },
  });

  static fitted = class Fitted extends Component<typeof Issue> {
    get statusColor(): string | undefined {
      let project = this.args.model?.kanbanBoard as Project | null;
      return findOptionColor(
        ((project?.issueStatusOptions as Option[])?.length
          ? (project?.issueStatusOptions as Option[])
          : issueStatusOptions) as Option[],
        this.args.model?.status ?? 'backlog',
      );
    }

    <template>
      <div class='issue-card compact'>
        <div class='row'>
          <strong>{{if @model.issueId @model.issueId 'ISSUE'}}</strong>
          <StatusPill @color={{this.statusColor}}>
            {{#if @model.status}}
              <@fields.status @format='atom' />
            {{else}}
              Backlog
            {{/if}}
          </StatusPill>
        </div>
        <div><@fields.cardTitle /></div>
      </div>
      <style scoped>
        .issue-card {
          display: grid;
          gap: 0.35rem;
        }
        .compact {
          padding: 0.75rem;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.8rem;
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof Issue> {
    get statusColor(): string | undefined {
      let project = this.args.model?.kanbanBoard as Project | null;
      return findOptionColor(
        ((project?.issueStatusOptions as Option[])?.length
          ? (project?.issueStatusOptions as Option[])
          : issueStatusOptions) as Option[],
        this.args.model?.status ?? 'backlog',
      );
    }

    <template>
      <article class='surface'>
        <header>
          <div class='row'>
            <strong>{{if @model.issueId @model.issueId 'ISSUE'}}</strong>
            <StatusPill @color={{this.statusColor}}>
              {{#if @model.status}}
                <@fields.status @format='atom' />
              {{else}}
                Backlog
              {{/if}}
            </StatusPill>
          </div>
          <h1><@fields.cardTitle /></h1>
        </header>
        {{#if @model.project}}
          <section>
            <h2>Project</h2>
            <div class='linked-card'>
              <@fields.project @format='embedded' />
            </div>
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
        {{#if @model.relatedKnowledge.length}}
          <section>
            <h2>Related Knowledge</h2>
            <@fields.relatedKnowledge />
          </section>
        {{/if}}
        {{#if @model.blockedBy.length}}
          <section>
            <h2>Blocked By</h2>
            <@fields.blockedBy />
          </section>
        {{/if}}
        {{#if @model.comments.length}}
          <section class='comments-section'>
            <h3>Comments</h3>
            <@fields.comments />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .surface {
          padding: 1.5rem;
          display: grid;
          gap: 1rem;
        }
        .linked-card {
          margin-bottom: 0.5rem;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.75rem;
        }
        .comments-section {
          margin-top: 1rem;
        }
        .comments-section h3 {
          font-size: var(--boxel-font-size);
          font-weight: 600;
          margin-bottom: 0.5rem;
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
  @field objective = contains(TextAreaField);
  @field scope = contains(MarkdownField);
  @field technicalContext = contains(MarkdownField);
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
  @field hideEmptyColumns = contains(BooleanField);
  @field groupBy = contains(
    enumField(StringField, {
      options: defaultColumns.map(({ value, label }) => ({
        value,
        label,
      })),
    }),
  );
  @field issuePriorityOptions = containsMany(IssueOptionField);
  @field issueStatusOptions = containsMany(IssueOptionField);
  @field issueTypeOptions = containsMany(IssueOptionField);
  @field statusColumnConfig = containsMany(KanbanColumnField);
  @field priorityColumnConfig = containsMany(KanbanColumnField);
  @field typeColumnConfig = containsMany(KanbanColumnField);
  @field columns = containsMany(KanbanColumnField, {
    computeVia: function (this: Project) {
      const source =
        defaultColumns.find((o) => o.value === this.groupBy) ??
        defaultColumns[0]!;
      const boardOptions =
        source.value === 'priority'
          ? (this.issuePriorityOptions as Option[] | undefined)
          : source.value === 'issueType'
            ? (this.issueTypeOptions as Option[] | undefined)
            : source.value === 'status'
              ? (this.issueStatusOptions as Option[] | undefined)
              : null;
      const options = boardOptions?.length ? boardOptions : source.options;
      const config = ((source.value === 'issueType'
        ? this.typeColumnConfig
        : source.value === 'priority'
          ? this.priorityColumnConfig
          : this.statusColumnConfig) ?? []) as KanbanColumnField[];
      return options
        .map((o, i) => {
          const stored = config.find((c) => c.key === o.value);
          return new KanbanColumnField({
            key: o.value,
            label: o.label,
            color: stored?.color ?? o.color,
            wipLimit: stored?.wipLimit ?? null,
            collapsed: stored?.collapsed ?? null,
            sortOrder: stored?.sortOrder ?? i,
          });
        })
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Project) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.projectName ?? 'Untitled Project');
    },
  });

  static fitted = class Fitted extends Component<typeof Project> {
    get statusColor(): string | undefined {
      return findOptionColor(
        projectStatusOptions,
        this.args.model?.projectStatus ?? 'planning',
      );
    }

    <template>
      <div class='project-card compact'>
        <div class='row'>
          <strong>{{if
              @model.projectCode
              @model.projectCode
              'PROJECT'
            }}</strong>
          <StatusPill @color={{this.statusColor}}>
            {{#if @model.projectStatus}}
              <@fields.projectStatus @format='atom' />
            {{else}}
              Planning
            {{/if}}
          </StatusPill>
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
          align-items: center;
          gap: 0.75rem;
          font-size: 0.8rem;
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof Project> {
    @tracked selectedCardIndex: number | null = null;
    @tracked showSettings = false;
    dragManager: KanbanDragManager | null = null;
    private orderInitPending = false;

    constructor(owner: Owner, args: any) {
      super(owner, args);
      this.initManager();
    }

    initManager(): void {
      this.dragManager = new KanbanDragManager({
        placements: () => this.kanbanPlacements,
        columnCount: () => this.kanbanColumns.length || 4,
        containerElement: () => null,
        onChange: (newPlacements) => this.commitPlacements(newPlacements),
        onSelect: (index) => {
          this.selectedCardIndex = index;
        },
        onOpen: (index) => {
          const card = (this.args.model?.issues as any[])?.[index];
          if (card) this.args.viewCard?.(card, 'isolated');
        },
      });
    }

    get kanbanPlacements(): KanbanPlacement[] {
      const cards = this.args.model?.issues ?? [];
      const columns = this.args.model?.columns ?? [];
      if ((cards as any[]).length === 0) return [];
      const maxSortOrder: Record<number, number> = {};
      const groupBy = this.args.model?.groupBy;
      const source =
        defaultColumns.find((o) => o.value === groupBy) ?? defaultColumns[0]!;
      const placements = (cards as any[]).map((card: any, index: number) => {
        const value = card[source.fieldName];
        const colIndex = (columns as any[]).findIndex(
          (col: any) => col.key === value,
        );
        const column = colIndex >= 0 ? colIndex : 0;
        const stored = card[source.orderField];
        let sortOrder: number;
        if (stored != null) {
          sortOrder = stored;
          maxSortOrder[column] = Math.max(maxSortOrder[column] ?? 0, stored);
        } else {
          maxSortOrder[column] = (maxSortOrder[column] ?? 0) + 1;
          sortOrder = maxSortOrder[column];
        }
        return { index, column, sortOrder };
      });

      // Persist default order for cards that don't have one yet (e.g. newly added).
      // Deferred so the write doesn't happen during rendering.
      const uninitialized = placements.filter(
        (p) => (cards as any[])[p.index]?.[source.orderField] == null,
      );
      if (uninitialized.length > 0 && !this.orderInitPending) {
        this.orderInitPending = true;
        const orderField = source.orderField;
        Promise.resolve().then(() => {
          this.orderInitPending = false;
          for (const p of uninitialized) {
            const card = (cards as any[])[p.index];
            if (card && card[orderField] == null) {
              card[orderField] = p.sortOrder;
            }
          }
        });
      }

      return placements;
    }

    get manager(): KanbanDragManager {
      if (!this.dragManager) this.initManager();
      return this.dragManager!;
    }

    get kanbanColumns(): KanbanColumnField[] {
      return this.args.model?.columns ?? [];
    }

    get cardCount(): number {
      return this.args.model?.issues?.length ?? 0;
    }

    get realmURL(): URL | undefined {
      return (this.args.model as any)[realmURL];
    }

    addCardToColumn = async (
      columnKey: string | null | undefined,
    ): Promise<void> => {
      if (!columnKey) return;
      const model = this.args.model;
      if (!model) return;

      const source =
        defaultColumns.find((o) => o.value === (model as any).groupBy) ??
        defaultColumns[0]!;
      const attributeName = source.fieldName;
      const kanbanBoardId = (model as any).id ?? null;

      await this.args.createCard?.(issueCodeRef, new URL(issueCodeRef.module), {
        realmURL: this.realmURL,
        doc: {
          data: {
            type: 'card',
            attributes: { [attributeName]: columnKey },
            relationships: {
              kanbanBoard: { links: { self: kanbanBoardId } },
              project: { links: { self: kanbanBoardId } },
            },
            meta: { adoptsFrom: issueCodeRef },
          },
        },
      });
    };

    get groupByOptions(): { displayName: string; sort: string }[] {
      return defaultColumns.map(({ value, label }) => ({
        displayName: label,
        sort: value,
      }));
    }

    get selectedGroupByOption():
      | { displayName: string; sort: string }
      | undefined {
      let groupBy = (this.args.model as any)?.groupBy ?? 'status';
      return (
        this.groupByOptions.find((option) => option.sort === groupBy) ??
        undefined
      );
    }

    onGroupByChange = (option: { displayName: string; sort: string }): void => {
      let model = this.args.model as any;
      if (!model || model.groupBy === option.sort) {
        return;
      }
      model.groupBy = option.sort;
    };

    get hideEmptyColumns(): boolean {
      return Boolean((this.args.model as any)?.hideEmptyColumns);
    }

    toggleHideEmptyColumns = (): void => {
      let model = this.args.model as any;
      if (!model) {
        return;
      }
      model.hideEmptyColumns = !this.hideEmptyColumns;
    };

    // ── Persistence ──────────────────────────────────────────────────

    commitPlacements = (newPlacements: KanbanPlacement[]): void => {
      const model = this.args.model;
      if (!model) return;
      const cards = model.issues as any[];
      const columns = model.columns as any[];
      if (!cards || !columns) return;
      const source =
        defaultColumns.find((o) => o.value === (model as any).groupBy) ??
        defaultColumns[0]!;
      for (const np of newPlacements) {
        const card = cards[np.index];
        const col = columns[np.column];
        if (card && col) {
          if (card[source.fieldName] !== col.key)
            card[source.fieldName] = col.key;
          if (card[source.orderField] !== np.sortOrder)
            card[source.orderField] = np.sortOrder;
        }
      }
    };

    // ── Settings ─────────────────────────────────────────────────────

    setColumnConfig = (key: string, patch: Record<string, unknown>): void => {
      const model = this.args.model as any;
      if (!model) return;
      const groupBy = model.groupBy ?? 'status';
      const configField =
        groupBy === 'issueType'
          ? 'issueColumnConfig'
          : groupBy === 'priority'
            ? 'priorityColumnConfig'
            : 'statusColumnConfig';
      const cols: KanbanColumnField[] = model[configField] ?? [];
      const cfg = cols.find((c: any) => c.key === key) as any;
      if (cfg) {
        for (const [k, v] of Object.entries(patch)) {
          cfg[k] = v;
        }
      } else {
        cols.push(new KanbanColumnField({ key, ...patch }));
      }
    };

    toggleSettings = (): void => {
      this.showSettings = !this.showSettings;
    };

    onColorChange = (key: string | null | undefined, event: Event): void => {
      if (!key) return;
      this.setColumnConfig(key, {
        color: (event.target as HTMLInputElement).value,
      });
    };

    onWipChange = (key: string | null | undefined, event: Event): void => {
      if (!key) return;
      const raw = (event.target as HTMLInputElement).valueAsNumber;
      this.setColumnConfig(key, {
        wipLimit: isNaN(raw) || raw <= 0 ? null : raw,
      });
    };

    onCollapseChange = (key: string | null | undefined, event: Event): void => {
      if (!key) return;
      this.setColumnConfig(key, {
        collapsed: (event.target as HTMLInputElement).checked,
      });
    };

    moveColUp = (key: string | null | undefined, _event: Event): void => {
      if (!key) return;
      const cols = this.kanbanColumns;
      const idx = cols.findIndex((c) => c.key === key);
      if (idx <= 0) return;
      const a = cols[idx]!;
      const b = cols[idx - 1]!;
      const aOrder = a.sortOrder ?? idx;
      const bOrder = b.sortOrder ?? idx - 1;
      this.setColumnConfig(a.key!, { sortOrder: bOrder });
      this.setColumnConfig(b.key!, { sortOrder: aOrder });
    };

    moveColDown = (key: string | null | undefined, _event: Event): void => {
      if (!key) return;
      const cols = this.kanbanColumns;
      const idx = cols.findIndex((c) => c.key === key);
      if (idx < 0 || idx >= cols.length - 1) return;
      const a = cols[idx]!;
      const b = cols[idx + 1]!;
      const aOrder = a.sortOrder ?? idx;
      const bOrder = b.sortOrder ?? idx + 1;
      this.setColumnConfig(a.key!, { sortOrder: bOrder });
      this.setColumnConfig(b.key!, { sortOrder: aOrder });
    };

    get statusColor() {
      return findOptionColor(
        projectStatusOptions,
        this.args.model.projectStatus ?? 'planning',
      );
    }

    // ── Template ─────────────────────────────────────────────────────

    <template>
      <div class='kanban-surface'>
        <header class='kanban-toolbar'>
          <div class='toolbar-left'>
            <div class='kanban-heading'>
              <div class='kanban-meta-top'>
                <Pill @size='extra-small'>
                  {{if @model.projectCode @model.projectCode 'BOARD'}}
                </Pill>
                <StatusPill @color={{this.statusColor}}>
                  {{#if @model.projectStatus}}
                    <@fields.projectStatus @format='atom' />
                  {{else}}
                    Planning
                  {{/if}}
                </StatusPill>
              </div>
              <h2 class='kanban-title'>
                <SquareKanban />
                <@fields.cardTitle />
              </h2>
              {{!-- {{#if @model.dueDate}}
              <div class='kanban-project'>
                <span class='dim-label'>Due Date</span>
                <@fields.dueDate @format='atom' />
              </div>
            {{/if}} --}}
            </div>
            <div>
              <span class='card-count'>{{this.cardCount}} cards</span>
            </div>
          </div>
          <div class='toolbar-right'>
            <div class='column-visibility-toggle'>
              <span class='group-by-label'>Hide empty</span>
              <Switch
                @isEnabled={{this.hideEmptyColumns}}
                @onChange={{this.toggleHideEmptyColumns}}
                @label='Hide empty columns'
              />
            </div>
            <div class='group-by-picker'>
              <SortDropdown
                @options={{this.groupByOptions}}
                @selectedOption={{this.selectedGroupByOption}}
                @onSelect={{this.onGroupByChange}}
              />
            </div>
            <ContextButton
              class='settings-button'
              @label='Toggle column settings'
              @icon='context-menu-vertical'
              @variant='ghost'
              {{on 'click' this.toggleSettings}}
            />
          </div>
        </header>

        <div class='kanban-main'>
          <div class='kanban-body'>
            <KanbanPlane
              @columns={{this.kanbanColumns}}
              @placements={{this.kanbanPlacements}}
              @manager={{this.manager}}
              @interactive={{true}}
              @hideEmpty={{@model.hideEmptyColumns}}
              @onAddCard={{this.addCardToColumn}}
            >
              <:card as |placement|>
                {{#let (get @fields.issues placement.index) as |CardField|}}
                  {{#if CardField}}
                    <div class='kanban-card-wrap'>
                      <CardField @format='fitted' @displayContainer={{false}} />
                    </div>
                  {{else}}
                    <div class='card-placeholder'>Card {{placement.index}}</div>
                  {{/if}}
                {{/let}}
              </:card>
              <:ghost as |dragIdx|>
                {{#let (get @fields.issues dragIdx) as |CardField|}}
                  {{#if CardField}}
                    <div class='ghost-wrap'>
                      <CardField @format='fitted' @displayContainer={{false}} />
                    </div>
                  {{/if}}
                {{/let}}
              </:ghost>
            </KanbanPlane>
          </div>

          {{#if this.showSettings}}
            <aside class='settings-panel'>
              <div class='settings-header'>Column Settings</div>
              {{#each this.kanbanColumns as |col|}}
                <div class='settings-row'>
                  <div class='settings-top'>
                    <span class='settings-name'>{{col.label}}</span>
                    <div class='settings-order'>
                      <button
                        type='button'
                        class='order-btn'
                        {{on 'click' (fn this.moveColUp col.key)}}
                      >↑</button>
                      <button
                        type='button'
                        class='order-btn'
                        {{on 'click' (fn this.moveColDown col.key)}}
                      >↓</button>
                    </div>
                  </div>
                  <div class='settings-controls'>
                    <label class='settings-field'>
                      <span class='field-label'>Color</span>
                      <input
                        type='color'
                        class='color-input'
                        value={{if col.color col.color '#6366f1'}}
                        {{on 'change' (fn this.onColorChange col.key)}}
                      />
                    </label>
                    <label class='settings-field'>
                      <span class='field-label'>WIP</span>
                      <input
                        type='number'
                        class='wip-input'
                        value={{col.wipLimit}}
                        min='0'
                        placeholder='∞'
                        {{on 'change' (fn this.onWipChange col.key)}}
                      />
                    </label>
                    <label class='settings-field'>
                      <input
                        type='checkbox'
                        checked={{col.collapsed}}
                        {{on 'change' (fn this.onCollapseChange col.key)}}
                      />
                      <span class='field-label'>Collapse</span>
                    </label>
                  </div>
                </div>
              {{/each}}
            </aside>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .kanban-surface {
          --kanban-surface-bg: var(--background, var(--boxel-200));
          --kanban-card-bg: var(--card, var(--boxel-light));
          --kanban-card-foreground: var(--card-foreground, var(--boxel-dark));
          --kanban-foreground: var(--foreground, var(--boxel-700));
          --kanban-muted-bg: var(--muted, var(--boxel-100));
          --kanban-muted-foreground: var(--muted-foreground, var(--boxel-450));
          --kanban-border-color: var(--border, var(--boxel-border-color));

          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 100%;
          background: var(--kanban-surface-bg);
          color: var(--kanban-foreground);
        }
        .kanban-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.625rem 1rem;
          border-bottom: 1px solid var(--kanban-border-color);
          background: var(--popup, var(--kanban-card-bg));
          color: var(--popup-foreground, var(--kanban-card-foreground));
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
        .kanban-meta-top {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .toolbar-right {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .group-by-picker {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 11rem;
        }
        .column-visibility-toggle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .group-by-label {
          font-size: 0.75rem;
          color: var(--kanban-muted-foreground);
          white-space: nowrap;
        }
        .group-by-picker :deep(.sort-options-label) {
          color: var(--kanban-muted-foreground);
          font-size: 0.75rem;
        }
        .group-by-picker :deep(.sort-button) {
          min-width: 8rem;
        }
        .kanban-title {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.875rem;
          font-weight: 600;
          margin: 0;
          letter-spacing: -0.01em;
        }
        .kanban-project {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .dim-label {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--kanban-muted-foreground);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .card-count {
          font-size: 0.75rem;
          color: var(--kanban-muted-foreground);
          padding: 0.125rem 0.5rem;
          background: var(--kanban-muted-bg);
          border-radius: 4px;
        }
        .settings-button {
          color: var(--kanban-muted-foreground);
        }
        .kanban-main {
          flex: 1;
          min-height: 0;
          display: flex;
          overflow: hidden;
        }
        .kanban-body {
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }
        .kanban-card-wrap {
          width: 100%;
          height: 100%;
          overflow: hidden;
          border-radius: inherit;
        }
        .ghost-wrap {
          width: 100%;
          height: 100%;
          overflow: hidden;
          border-radius: inherit;
        }
        .card-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          font-size: 0.75rem;
          color: var(--kanban-muted-foreground);
        }
        /* ── Settings panel ── */
        .settings-panel {
          width: 15rem;
          flex-shrink: 0;
          background: var(--kanban-card-bg);
          border-left: 1px solid var(--kanban-border-color);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }
        .settings-header {
          padding: 0.5rem 0.75rem;
          border-bottom: 1px solid var(--kanban-border-color);
          font-size: 0.6875rem;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--kanban-muted-foreground);
          flex-shrink: 0;
        }
        .settings-row {
          padding: 0.625rem 0.75rem;
          border-bottom: 1px solid var(--kanban-border-color);
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .settings-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .settings-name {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--kanban-foreground);
        }
        .settings-order {
          display: flex;
          gap: 0.125rem;
        }
        .order-btn {
          padding: 0.0625rem 0.3125rem;
          font-size: 0.6875rem;
          line-height: 1.4;
          background: var(--kanban-muted-bg);
          border: 1px solid var(--kanban-border-color);
          border-radius: 3px;
          cursor: pointer;
          color: var(--kanban-foreground);
        }
        .order-btn:hover {
          background: var(--kanban-border-color);
        }
        .settings-controls {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          flex-wrap: wrap;
        }
        .settings-field {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          cursor: pointer;
        }
        .field-label {
          font-size: 0.6875rem;
          color: var(--kanban-muted-foreground);
        }
        .color-input {
          width: 1.5rem;
          height: 1.125rem;
          padding: 0;
          border: 1px solid var(--kanban-border-color);
          border-radius: 3px;
          cursor: pointer;
        }
        .wip-input {
          width: 2.75rem;
          padding: 0.125rem 0.25rem;
          font-size: 0.6875rem;
          border: 1px solid var(--kanban-border-color);
          border-radius: 3px;
          background: var(--kanban-muted-bg);
          color: var(--kanban-foreground);
        }
      </style>
    </template>
  };
  // static isolated = class Isolated extends Component<typeof Project> {
  //   <template>
  //     <article class='surface'>
  //       <header>
  //         <div class='row'>
  //           <strong>{{if
  //               @model.projectCode
  //               @model.projectCode
  //               'PROJECT'
  //             }}</strong>
  //           <span
  //             class='status status-{{if
  //                 @model.projectStatus
  //                 @model.projectStatus
  //                 "planning"
  //               }}'
  //           >{{if @model.projectStatus @model.projectStatus 'planning'}}</span>
  //         </div>
  //         <h1>{{if
  //             @model.projectName
  //             @model.projectName
  //             'Untitled Project'
  //           }}</h1>
  //       </header>
  //       {{#if @model.objective}}
  //         <section>
  //           <h2>Objective</h2>
  //           <p>{{@model.objective}}</p>
  //         </section>
  //       {{/if}}
  //       {{#if @model.scope}}
  //         <section>
  //           <h2>Scope</h2>
  //           <@fields.scope />
  //         </section>
  //       {{/if}}
  //       {{#if @model.technicalContext}}
  //         <section>
  //           <h2>Technical Context</h2>
  //           <@fields.technicalContext />
  //         </section>
  //       {{/if}}
  //       {{#if @model.successCriteria}}
  //         <section>
  //           <h2>Success Criteria</h2>
  //           <@fields.successCriteria />
  //         </section>
  //       {{/if}}
  //       {{#if @model.issues.length}}
  //         <section>
  //           <h2>Issues</h2>
  //           <@fields.issues />
  //         </section>
  //       {{/if}}
  //       {{#if @model.knowledgeBase.length}}
  //         <section>
  //           <h2>Knowledge Base</h2>
  //           <@fields.knowledgeBase />
  //         </section>
  //       {{/if}}
  //     </article>
  //     <style scoped>
  //       .surface {
  //         padding: 1.5rem;
  //         display: grid;
  //         gap: 1rem;
  //       }
  //       .row {
  //         display: flex;
  //         justify-content: space-between;
  //         align-items: center;
  //         gap: 0.75rem;
  //       }
  //       .status {
  //         font-size: 0.75rem;
  //         text-transform: uppercase;
  //         font-weight: 600;
  //         padding: 0.125rem 0.5rem;
  //         border-radius: 0.25rem;
  //       }
  //       .status-active {
  //         color: var(--boxel-blue);
  //         background: color-mix(in oklch, var(--boxel-blue) 12%, transparent);
  //       }
  //       .status-planning {
  //         color: var(--boxel-400);
  //         background: var(--muted);
  //       }
  //       .status-completed {
  //         color: var(--boxel-green);
  //         background: color-mix(in oklch, var(--boxel-green) 12%, transparent);
  //       }
  //       .status-on_hold {
  //         color: var(--boxel-orange);
  //         background: color-mix(in oklch, var(--boxel-orange) 12%, transparent);
  //       }
  //       .status-archived {
  //         color: var(--boxel-400);
  //         background: var(--muted);
  //       }
  //     </style>
  //   </template>
  // };

  // ── Edit ───────────────────────────────────────────────────────────

  static edit = class Edit extends Component<typeof Project> {
    constructor(owner: Owner, args: any) {
      super(owner, args);
      Promise.resolve().then(() => {
        let model = this.args.model as Project | undefined;
        if (!model) return;

        if (!model.issuePriorityOptions?.length) {
          model.issuePriorityOptions =
            buildIssueOptionFields(issuePriorityOptions);
        }
        if (!model.issueStatusOptions?.length) {
          model.issueStatusOptions = buildIssueOptionFields(issueStatusOptions);
        }
        if (!model.issueTypeOptions?.length) {
          model.issueTypeOptions = buildIssueOptionFields(issueTypeOptions);
        }
      });
    }

    get groupBy(): string {
      return (this.args.model as any)?.groupBy ?? 'status';
    }
    get isStatus(): boolean {
      return this.groupBy === 'status';
    }
    get isPriority(): boolean {
      return this.groupBy === 'priority';
    }
    get colConfigLabel(): string {
      if (this.groupBy === 'priority') return 'Priority Column Config';
      if (this.groupBy === 'issueType') return 'Type Column Config';
      return 'Status Column Config';
    }

    <template>
      <div class='kanban-edit'>
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
          {{!-- <FieldContainer @label='Due Date' @vertical={{true}}>
            <@fields.dueDate />
          </FieldContainer> --}}
        </div>

        {{!-- <FieldContainer @label='Description' @vertical={{true}}>
          <@fields.description />
        </FieldContainer> --}}

        <div class='row'>
          <FieldContainer @label='Theme' @vertical={{true}}>
            <@fields.cardInfo.theme />
          </FieldContainer>
          <FieldContainer @label='Group By' @vertical={{true}}>
            <@fields.groupBy />
          </FieldContainer>
        </div>

        <div class='row'>
          <FieldContainer @label='Hide Empty Columns' @vertical={{true}}>
            <@fields.hideEmptyColumns />
          </FieldContainer>
        </div>

        <section class='options-section'>
          <div class='options-section-header'>
            <h2 class='section-title'>Issue Configuration</h2>
            <p class='section-copy'>
              Define the status, priority, and type options that issues in this
              board can use.
            </p>
          </div>

          <div class='options-section-body'>
            <div class='options-config-panel'>
              <FieldContainer @label='Issue Status Options' @vertical={{true}}>
                <@fields.issueStatusOptions />
              </FieldContainer>
            </div>

            <div class='options-config-panel'>
              <FieldContainer
                @label='Issue Priority Options'
                @vertical={{true}}
              >
                <@fields.issuePriorityOptions />
              </FieldContainer>
            </div>

            <div class='options-config-panel'>
              <FieldContainer @label='Issue Type Options' @vertical={{true}}>
                <@fields.issueTypeOptions />
              </FieldContainer>
            </div>
          </div>
        </section>

        <div class='col-config-row'>
          <FieldContainer @label='Configured Columns' @vertical={{true}}>
            <@fields.columns />
          </FieldContainer>
        </div>
      </div>
      <style scoped>
        .kanban-edit {
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
        .options-section-body {
          display: grid;
          gap: var(--boxel-sp);
        }
        .options-config-panel {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
          background: var(--sidebar, var(--background));
          color: var(--sidebar-foreground, var(--foreground));
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius);
          box-shadow: inset 0 1px 0
            color-mix(in oklch, var(--card) 35%, transparent);
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
        .col-config-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
          min-width: 0;
          align-items: start;
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
