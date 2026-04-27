import { tracked } from '@glimmer/tracking';
import { dropTask } from 'ember-concurrency';
import { get } from '@ember/helper';
import Owner from '@ember/owner';

import {
  CardDef,
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

import { FieldContainer } from '@cardstack/boxel-ui/components';

import { realmURL } from '@cardstack/runtime-common';

import { IssueOptionField } from './issue-option';
import { KanbanColumnField } from './kanban-column';
import { KanbanPlane } from '@cardstack/boxel-ui/components';
import { StatusPill } from './status-pill';
import { ProjectKanbanController } from './project-kanban-controller';
import { ProjectKanbanSettingsPanel } from './project-kanban-settings-panel';
import { ProjectKanbanToolbar } from './project-kanban-toolbar';

import {
  type Option,
  issueStatusOptions,
  issueTypeOptions,
  issuePriorityOptions,
  findOptionColor,
  buildIssueOptionFields,
  IssueStatusField,
  IssueTypeField,
  IssuePriorityField,
  ProjectStatusField,
  GroupByField,
  projectStatusOptions,
} from './kanban-config';
import { Comment } from './comment';
import { KnowledgeArticle } from './knowledge-article';

export { AgentProfile } from './agent-profile';
export { KnowledgeArticle } from './knowledge-article';
export { Comment } from './comment';
export { KnowledgeTypeField } from './knowledge-article';

const issueCodeRef = {
  // @ts-expect-error this is not a CJS file, import.meta is allowed
  module: new URL('./darkfactory', import.meta.url).href,
  name: 'Issue',
};

function issueStatusColor(
  statusOptions: IssueOptionField[] | undefined,
  status: string | null | undefined,
): string | undefined {
  return findOptionColor(
    statusOptions?.length ? (statusOptions as Option[]) : issueStatusOptions,
    status ?? 'backlog',
  );
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
      const project = this.args.model?.project as Project | null;
      return issueStatusColor(
        project?.issueStatusOptions,
        this.args.model?.status,
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
      const project = this.args.model?.project;
      return issueStatusColor(
        project?.issueStatusOptions,
        this.args.model?.status,
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

class ProjectIsolated extends Component<typeof Project> {
  @tracked selectedCardIndex: number | null = null;
  @tracked showSettings = false;
  board: ProjectKanbanController;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.board = new ProjectKanbanController(
      () => this.args.model,
      () => this.realmURL,
      issueCodeRef,
      this.args.createCard,
      this.args.viewCard,
      (index) => {
        this.selectedCardIndex = index;
      },
    );
  }

  get manager() {
    return this.board.manager;
  }

  get kanbanPlacements() {
    return this.board.kanbanPlacements;
  }

  get kanbanColumns() {
    return this.board.kanbanColumns;
  }

  get cardCount(): number {
    return this.board.cardCount;
  }

  get realmURL(): URL | undefined {
    return (this.args.model as any)[realmURL];
  }

  addCardToColumn = dropTask(async (columnKey: string | null | undefined) => {
    await this.board.addCardToColumn(columnKey);
  });

  get groupByOptions(): { displayName: string; sort: string }[] {
    return this.board.groupByOptions;
  }

  get selectedGroupByOption():
    | { displayName: string; sort: string }
    | undefined {
    return this.board.selectedGroupByOption;
  }

  onGroupByChange = (option: { displayName: string; sort: string }): void => {
    this.board.setGroupBy(option.sort);
  };

  get hideEmptyColumns(): boolean {
    return this.board.hideEmptyColumns;
  }

  toggleHideEmptyColumns = (): void => {
    this.board.toggleHideEmptyColumns();
  };

  // ── Settings ─────────────────────────────────────────────────────

  toggleSettings = (): void => {
    this.showSettings = !this.showSettings;
  };

  onColorChange = (key: string | null | undefined, event: Event): void => {
    this.board.setColumnColor(key, (event.target as HTMLInputElement).value);
  };

  onWipChange = (key: string | null | undefined, event: Event): void => {
    this.board.setColumnWipLimit(
      key,
      (event.target as HTMLInputElement).valueAsNumber,
    );
  };

  onCollapseChange = (key: string | null | undefined, event: Event): void => {
    this.board.setColumnCollapsed(
      key,
      (event.target as HTMLInputElement).checked,
    );
  };

  moveColUp = (key: string | null | undefined, _event: Event): void => {
    this.board.moveColUp(key);
  };

  moveColDown = (key: string | null | undefined, _event: Event): void => {
    this.board.moveColDown(key);
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
      <ProjectKanbanToolbar
        @model={{@model}}
        @cardCount={{this.cardCount}}
        @hideEmptyColumns={{this.hideEmptyColumns}}
        @groupByOptions={{this.groupByOptions}}
        @selectedGroupByOption={{this.selectedGroupByOption}}
        @statusColor={{this.statusColor}}
        @onToggleHideEmptyColumns={{this.toggleHideEmptyColumns}}
        @onGroupByChange={{this.onGroupByChange}}
        @onToggleSettings={{this.toggleSettings}}
        @projectStatusField={{@fields.projectStatus}}
        @cardTitleField={{@fields.cardTitle}}
      />

      <div class='kanban-main'>
        <div class='kanban-body'>
          <KanbanPlane
            @columns={{this.kanbanColumns}}
            @placements={{this.kanbanPlacements}}
            @manager={{this.manager}}
            @interactive={{true}}
            @hideEmpty={{@model.hideEmptyColumns}}
            @onAddCard={{this.addCardToColumn.perform}}
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
          <ProjectKanbanSettingsPanel
            @columns={{this.kanbanColumns}}
            @onColorChange={{this.onColorChange}}
            @onWipChange={{this.onWipChange}}
            @onCollapseChange={{this.onCollapseChange}}
            @onMoveColUp={{this.moveColUp}}
            @onMoveColDown={{this.moveColDown}}
          />
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
        --kanban-muted-foreground: var(--muted-foreground, var(--boxel-500));
        --kanban-border-color: var(--border, var(--boxel-border-color));

        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 100%;
        background: var(--kanban-surface-bg);
        color: var(--kanban-foreground);
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
    </style>
  </template>
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
  @field groupBy = contains(GroupByField);
  @field issuePriorityOptions = containsMany(IssueOptionField);
  @field issueStatusOptions = containsMany(IssueOptionField);
  @field issueTypeOptions = containsMany(IssueOptionField);
  @field statusColumnConfig = containsMany(KanbanColumnField);
  @field priorityColumnConfig = containsMany(KanbanColumnField);
  @field typeColumnConfig = containsMany(KanbanColumnField);

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

  static isolated = ProjectIsolated;

  // ── Edit ───────────────────────────────────────────────────────────

  static edit = class Edit extends Component<typeof Project> {
    constructor(owner: Owner, args: any) {
      super(owner, args);
      Promise.resolve().then(() => {
        const model = this.args.model;
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
      return this.args.model?.groupBy ?? 'status';
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
        </div>

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
      </style>
    </template>
  };
}

export class DarkFactory extends CardDef {
  static displayName = 'Dark Factory';

  @field factoryName = contains(StringField);
  @field description = contains(MarkdownField);
  @field activeProjects = linksToMany(() => Project);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: DarkFactory) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.factoryName ?? 'Dark Factory');
    },
  });

  static fitted = class Fitted extends Component<typeof DarkFactory> {
    <template>
      <div class='compact'>
        <strong><@fields.cardTitle /></strong>
      </div>
      <style scoped>
        .compact {
          padding: 0.75rem;
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof DarkFactory> {
    <template>
      <article class='surface'>
        <h1><@fields.cardTitle /></h1>
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
