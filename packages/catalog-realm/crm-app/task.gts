import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import {
  FieldContainer,
  Pill,
  ProgressBar,
  ProgressRadial,
  EntityDisplayWithIcon,
} from '@cardstack/boxel-ui/components';
import CheckboxIcon from '@cardstack/boxel-icons/checkbox';
import Calendar from '@cardstack/boxel-icons/calendar';

import { CrmApp } from './crm-app';
import { Contact } from './contact';
import { Account } from './account';
import { Deal } from './deal';
import { Representative } from './representative';

import { Task, getDueDateStatus, TaskCompletionStatus } from './base-task';
import { CRMTaskStatusField } from './shared';

export class Issues extends CardDef {
  static displayName = 'Issues';
}

function extractId(href: string): string {
  const urlObj = new URL(href);
  const pathname = urlObj.pathname;
  const parts = pathname.split('/');
  const lastPart = parts[parts.length - 1];
  return lastPart.replace('.json', '');
}

function shortenId(id: string): string {
  const shortUuid = id.slice(0, 8);
  const decimal = parseInt(shortUuid, 16);
  return decimal.toString(36).padStart(6, '0');
}

class TaskEdit extends Component<typeof CRMTask> {
  <template>
    <div class='task-form'>
      <FieldContainer @label='Name'>
        <@fields.name />
      </FieldContainer>
      <FieldContainer @label='Assignee'>
        <@fields.assignee />
      </FieldContainer>
      <FieldContainer @label='Contact'>
        <@fields.contact />
      </FieldContainer>
      <FieldContainer @label='Account'>
        <@fields.account />
      </FieldContainer>
      <FieldContainer @label='Deal'>
        <@fields.deal />
      </FieldContainer>
      <FieldContainer @label='Status'>
        <@fields.status />
      </FieldContainer>
      <FieldContainer @label='Date Range'>
        <@fields.dateRange />
      </FieldContainer>
      <FieldContainer @label='Details'>
        <@fields.details />
      </FieldContainer>
      <FieldContainer @label='Priority'>
        <@fields.priority />
      </FieldContainer>
      <FieldContainer @label='Subtasks'>
        <@fields.subtasks />
      </FieldContainer>
      <FieldContainer @label='Tags'>
        <@fields.tags />
      </FieldContainer>
      <FieldContainer @label='CRM App'>
        <@fields.crmApp />
      </FieldContainer>
    </div>
    <style scoped>
      .task-form {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

class TaskIsolated extends Component<typeof CRMTask> {
  get taskTitle() {
    return this.args.model.name ?? 'No Task Title';
  }

  get dueDate() {
    return this.args.model.dateRange?.end;
  }

  get dueDateStatus() {
    return this.dueDate ? getDueDateStatus(this.dueDate.toString()) : undefined;
  }

  get hasDueDate() {
    return Boolean(this.dueDate);
  }

  get hasDueDateStatus() {
    return Boolean(this.dueDateStatus);
  }

  <template>
    <div class='task-container'>
      <header>
        <div class='left-column'>
          <h2 class='task-title'>{{this.taskTitle}}</h2>
          <div class='status-label'>
            <span class='text-gray'>in</span>
            {{@model.status.label}}
          </div>
        </div>

        <div class='right-column'>
          <ProgressRadial
            @value={{this.progress}}
            @max={{100}}
            @variant='circular'
            class='task-progress-radial'
          />
          {{#if this.hasProgress}}
            <ProgressBar
              @value={{this.progress}}
              @max={{100}}
              @label={{this.progressLabel}}
              @variant='horizontal'
              class='task-progress-bar'
            />
          {{/if}}
        </div>
      </header>

      <hr class='task-divider border-gray' />

      <div class='task-info'>
        <div class='left-column'>
          <h4>Description</h4>
          {{#if @model.details}}
            <@fields.details />
          {{else}}
            <span class='no-data-found-txt'>No Task Description Provided</span>
          {{/if}}
        </div>

        <div class='right-column'>
          <div class='assignee'>
            <h4>Assignee</h4>

            {{#if @model.assignee}}
              <@fields.assignee
                @format='atom'
                @displayContainer={{false}}
                class='task-assignee'
              />
            {{else}}
              <span class='no-data-found-txt'>No Assignees Found</span>
            {{/if}}
          </div>

          <div class='due-date'>
            <h4>Due Date</h4>
            <div class='date-info-container'>
              {{#if this.hasDueDate}}
                <div class='date-status-pill-container'>
                  {{#if this.dueDateStatus}}
                    <Pill
                      class='date-status-pill'
                      @pillBackgroundColor={{this.dueDateStatus.color}}
                    >
                      <:default>{{this.dueDateStatus.label}}</:default>
                    </Pill>
                  {{/if}}

                  <div class='calendar-icon-container'>
                    <Calendar
                      width='14px'
                      height='14px'
                      class='calendar-icon'
                    />
                    <@fields.dateRange.end @format='atom' />
                  </div>
                </div>
              {{else}}
                <span class='no-data-found-txt'>No Due Date Assigned</span>
              {{/if}}
            </div>
          </div>

          <div class='tags'>
            <h4>Tags</h4>
            {{#if @model.tags}}
              <div class='task-tags'>
                {{#each @fields.tags as |Tag|}}
                  <Tag
                    @format='atom'
                    class='task-tag'
                    @displayContainer={{false}}
                  />
                {{/each}}
              </div>
            {{else}}
              <span class='no-data-found-txt'>No Tags Found</span>
            {{/if}}
          </div>
        </div>
      </div>

      <hr class='task-divider border-white' />

      <div class='task-subtasks'>
        <h4>Subtasks ({{@model.subtasks.length}})</h4>

        {{#if @model.subtasks}}
          <@fields.subtasks @format='fitted' />
        {{else}}
          <span class='no-data-found-txt'>No Subtasks Found</span>
        {{/if}}
      </div>
    </div>

    <style scoped>
      h2,
      h4,
      p {
        margin-block-start: 0;
        margin-block-end: 1em;
        word-break: break-word;
      }
      p {
        font-size: var(--boxel-font-size-sm);
      }
      .task-container {
        --task-font-weight-500: 500;
        --task-font-weight-600: 600;
        --task-font-size-extra-small: calc(var(--boxel-font-size-xs) * 0.95);
        padding: var(--boxel-sp-lg);
        container-type: inline-size;
      }
      .task-container > * {
        margin-top: var(--boxel-sp-lg);
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .task-title {
        font-size: var(--boxel-font-size-md);
        font-weight: var(--task-font-weight-600);
      }
      .status-label {
        font-size: var(--boxel-font-size-sm);
        font-weight: var(--task-font-weight-600);
        margin-top: var(--boxel-sp-xs);
      }
      .text-gray {
        color: var(--boxel-400);
      }
      .task-progress-bar {
        display: none;
        --progress-bar-font-color: var(--boxel-dark);
        border: 0px;
        margin-top: var(--boxel-sp);
      }
      .task-divider.border-gray {
        border: 1px solid var(--boxel-100);
      }
      .task-divider.border-white {
        border: 1px solid var(--boxel-light);
      }
      .task-info {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-xl);
      }
      .task-info .right-column {
        display: grid;
        gap: var(--boxel-sp-xl);
      }
      .task-assignee {
        width: auto;
        height: auto;
        overflow: unset;
      }
      .task-tags {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        overflow: hidden;
      }
      .task-tag {
        width: auto;
        height: auto;
        overflow: unset;
      }
      .no-data-found-txt {
        font-size: calc(var(--boxel-font-size-xs) * 0.95);
        font-weight: var(--task-font-weight-500);
        color: var(--boxel-400);
        white-space: nowrap;
        -webkit-line-clamp: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 1px;
      }
      .date-status-pill-container {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }
      .date-status-pill {
        height: 24px;
        border: none;
        border-radius: 5px 0 0 5px;
        font-size: var(--task-font-size-extra-small);
        font-weight: var(--task-font-weight-500);
        position: relative;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-sm) var(--boxel-sp-5xs)
          var(--boxel-sp-xxs);
        clip-path: polygon(
          0 0,
          calc(100% - 8px) 0,
          100% 50%,
          calc(100% - 8px) 100%,
          0 100%
        );
      }
      .calendar-icon-container {
        font-size: var(--task-font-size-extra-small);
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        overflow: hidden;
      }
      .calendar-icon {
        flex-shrink: 0;
      }

      @container (max-width: 600px) {
        header {
          display: block;
        }
        .task-progress-radial {
          display: none;
        }
        .task-progress-bar {
          display: block;
        }
        .task-info {
          grid-template-columns: 1fr;
          gap: var(--boxel-sp-lg);
        }
        .task-info .right-column {
          gap: var(--boxel-sp-lg);
        }
      }
    </style>
  </template>

  get tagNames() {
    return this.args.model.tags?.map((tag) => tag.name) ?? [];
  }
  get hasDateRange() {
    return this.args.model.dateRange;
  }

  get progress() {
    if (!this.hasChildren) return 0;
    const shippedCount = this.args.model.subtasks!.filter(
      (child) => child.status.label === 'Shipped',
    ).length;

    return Math.round((shippedCount / this.childrenCount) * 100);
  }

  get hasProgress() {
    return this.progress > 0;
  }

  get progressLabel() {
    return `${this.progress}%`;
  }

  get hasChildren() {
    return this.args.model.subtasks && this.args.model.subtasks.length > 0;
  }

  get childrenCount() {
    return this.args.model.subtasks ? this.args.model.subtasks.length : 0;
  }

  get shippedCount() {
    return this.args.model.subtasks
      ? this.args.model.subtasks.filter(
          (child) => child.status.label === 'Shipped',
        ).length
      : 0;
  }
}

export class TaskEmbedded extends Component<typeof CRMTask> {
  get taskTitle() {
    return this.args.model.name ?? 'No Task Title';
  }

  get shortId() {
    return this.args.model.shortId;
  }

  get hasShortId() {
    return Boolean(this.shortId);
  }

  get visibleTags() {
    return [this.args.fields.tags[0], this.args.fields.tags[1]].filter(Boolean);
  }

  get dueDate() {
    return this.args.model.dateRange?.end;
  }

  get dueDateStatus() {
    return this.dueDate ? getDueDateStatus(this.dueDate.toString()) : undefined;
  }

  get hasDueDate() {
    return Boolean(this.dueDate);
  }

  get hasDueDateStatus() {
    return Boolean(this.dueDateStatus);
  }

  get isCompleted() {
    return this.args.model.status?.completed ?? false;
  }

  get hasStatus() {
    return this.args.model.status?.label ?? false;
  }

  <template>
    <div class='task-card'>
      <EntityDisplayWithIcon
        @title={{this.taskTitle}}
        class='task-entity-display'
      >
        <:icon>
          <TaskCompletionStatus
            class='task-completion-status'
            @completed={{this.isCompleted}}
          />
        </:icon>
        <:content>
          <div class='task-mobile-due-date-content'>
            {{#if this.hasDueDate}}
              <@fields.dateRange.end @format='atom' />
            {{else}}
              <span class='no-data-found-txt'>No Due Date Assigned</span>
            {{/if}}
          </div>
        </:content>

      </EntityDisplayWithIcon>

      <aside class='task-desktop-side-info'>
        {{#if this.hasShortId}}
          <Pill class='task-status-pill' @pillBackgroundColor='#f8f7fa'>
            <:default>{{@model.shortId}}</:default>
          </Pill>
        {{/if}}

        {{#if this.hasDueDate}}
          <Pill class='task-status-pill' @pillBackgroundColor='#f8f7fa'>
            <:iconLeft>
              <Calendar width='14px' height='14px' class='calendar-icon' />
            </:iconLeft>
            <:default>
              <@fields.dateRange.end @format='atom' />
            </:default>
          </Pill>
        {{/if}}

        {{#if this.hasStatus}}
          <Pill
            class='task-status-pill'
            @pillBackgroundColor={{@model.status.color}}
          >
            <:default>{{@model.status.label}}</:default>
          </Pill>
        {{/if}}
      </aside>
    </div>

    <style scoped>
      .task-card {
        --entity-display-icon-size: 18px;
        --entity-display-title-font-weight: 600;
        width: 100%;
        height: 100%;
        padding: var(--task-card-padding, var(--boxel-sp));
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--task-card-gap, var(--boxel-sp-sm));
        overflow: hidden;
        container-type: inline-size;
      }
      .task-mobile-due-date-content {
        display: none;
      }
      .task-entity-display :where(.entity-info) {
        gap: 0;
      }
      .task-completion-status {
        --boxel-circle-size: 14px;
        --boxel-border-radius: var(--boxel-border-radius-xs);
      }
      .task-status-pill {
        flex-shrink: 0;
      }
      aside.task-desktop-side-info {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: end;
        gap: var(--boxel-sp-xs);
      }

      @container (max-width: 600px) {
        aside.task-desktop-side-info {
          display: none;
        }
        .task-mobile-due-date-content {
          display: block;
        }
      }
    </style>
  </template>
}

export class CRMTask extends Task {
  static displayName = 'CRM Task';
  static icon = CheckboxIcon;
  @field crmApp = linksTo(() => CrmApp);
  @field subtasks = linksToMany(() => CRMTask);
  @field status = contains(CRMTaskStatusField);

  @field title = contains(StringField, {
    computeVia: function (this: CRMTask) {
      return this.name;
    },
  });

  @field assignee = linksTo(() => Representative);
  @field contact = linksTo(() => Contact);
  @field account = linksTo(() => Account);
  @field deal = linksTo(() => Deal);

  @field shortId = contains(StringField, {
    computeVia: function (this: CRMTask) {
      if (this.id) {
        let id = shortenId(extractId(this.id));
        let _shortId: string;
        _shortId = id;
        return _shortId.toUpperCase();
      }
      return;
    },
  });

  static edit = TaskEdit;
  static isolated = TaskIsolated;
  static embedded = TaskEmbedded;
}
