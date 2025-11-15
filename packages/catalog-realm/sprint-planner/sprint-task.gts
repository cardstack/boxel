import {
  Avatar,
  Pill,
  ProgressBar,
  ProgressRadial,
} from '@cardstack/boxel-ui/components';
import Calendar from '@cardstack/boxel-icons/calendar';
import CheckboxIcon from '@cardstack/boxel-icons/checkbox';
import FolderGitIcon from '@cardstack/boxel-icons/folder-git';
import UserIcon from '@cardstack/boxel-icons/user';
import UsersIcon from '@cardstack/boxel-icons/users';
import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { Task, TaskStatusField, getDueDateStatus } from './task';
import { User } from './user';

export class Team extends CardDef {
  static displayName = 'Team';
  static icon = UsersIcon;
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Team) {
      return this.name;
    },
  });

  @field shortName = contains(StringField, {
    computeVia: function (this: Team) {
      return this.name ? this.name.slice(0, 2).toUpperCase() : undefined;
    },
  });

  static atom = class Atom extends Component<typeof this> {
    <template>
      <Pill>
        <:default>
          {{@model.name}}
        </:default>
      </Pill>
    </template>
  };
}

export class TeamMember extends User {
  static displayName = 'Team Member';
  static icon = UserIcon;
  @field team = linksTo(Team);

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model}}
        <div class='assignee-display'>
          <Avatar
            class='avatar'
            @userId={{@model.id}}
            @displayName={{@model.name}}
            @isReady={{true}}
          />
          <span class='assignee-name'>
            {{@model.name}}
          </span>
        </div>
      {{/if}}
      <style scoped>
        .assignee-display {
          display: inline-flex;
          align-items: center;
          background-color: var(--boxel-200);
          border-radius: 100px;
          overflow: hidden;
          max-width: 100px;
          width: fit-content;
        }
        .avatar {
          --profile-avatar-icon-size: 20px;
          --profile-avatar-icon-border: 0px;
          flex-shrink: 0;
        }
        .assignee-name {
          padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-xxxs);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };
}

export class Project extends CardDef {
  static displayName = 'Project';
  static icon = FolderGitIcon;
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Project) {
      return this.name;
    },
  });
  static atom = class Atom extends Component<typeof this> {
    <template>
      <Pill class='project-pill'>
        <:default>
          {{@model.name}}
        </:default>
      </Pill>
      <style scoped>
        .project-pill {
          --boxel-pill-background-color: var(--boxel-purple);
          background: var(--profile-avatar-icon-background);
        }
      </style>
    </template>
  };
}

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

class TaskIsolated extends Component<typeof SprintTask> {
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
          <h2 class='task-title'>{{@model.name}}</h2>
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
        --tasl-font-size-extra-small: calc(var(--boxel-font-size-xs) * 0.95);
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
        font-size: var(--tasl-font-size-extra-small);
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
        font-size: var(--tasl-font-size-extra-small);
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

export class SprintTaskStatusField extends TaskStatusField {
  static values = [
    { index: 0, label: 'Not Started', color: '#B0BEC5', completed: false },
    {
      index: 1,
      label: 'Next Sprint',
      color: '#64B5F6',
      completed: false,
    },
    {
      index: 2,
      label: 'Current Sprint',
      color: '#00BCD4',
      completed: false,
    },
    {
      index: 3,
      label: 'In Progress',
      color: '#FFB74D',
      completed: false,
    },
    {
      index: 4,
      label: 'In Review',
      color: '#9575CD',
      completed: false,
    },
    {
      index: 5,
      label: 'Staged',
      color: '#26A69A',
      completed: false,
    },
    {
      index: 6,
      label: 'Shipped',
      color: '#66BB6A',
      completed: true,
    },
  ];
}

export class SprintTask extends Task {
  static displayName = 'Sprint Task';
  static icon = CheckboxIcon;
  @field project = linksTo(() => Project);
  @field team = linksTo(() => Team, { isUsed: true });
  @field subtasks = linksToMany(() => SprintTask);
  @field status = contains(SprintTaskStatusField);

  @field title = contains(StringField, {
    computeVia: function (this: SprintTask) {
      return this.name;
    },
  });

  @field assignee = linksTo(() => TeamMember);

  @field shortId = contains(StringField, {
    computeVia: function (this: SprintTask) {
      if (this.id) {
        let id = shortenId(extractId(this.id));
        let _shortId: string;
        if (this.team && this.team.shortName) {
          _shortId = this.team.shortName + '-' + id;
        } else {
          _shortId = id;
        }
        return _shortId.toUpperCase();
      }
      return;
    },
  });

  static isolated = TaskIsolated;
}
