import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import {
  BoxelSelect,
  Avatar,
  Pill,
  RadioInput,
  ProgressBar,
} from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import DateField from 'https://cardstack.com/base/date';
import TextAreaCard from '../../base/text-area';
import { cssVar } from '@cardstack/boxel-ui/helpers';
import { CheckMark } from '@cardstack/boxel-ui/icons';
import FolderGitIcon from '@cardstack/boxel-icons/folder-git';
import TagIcon from '@cardstack/boxel-icons/tag';
import CheckboxIcon from '@cardstack/boxel-icons/checkbox';
import UsersIcon from '@cardstack/boxel-icons/users';
import UserIcon from '@cardstack/boxel-icons/user';
import Calendar from '@cardstack/boxel-icons/calendar';

export class LooseGooseyField extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  static values: LooseyGooseyData[] = []; //help with the types

  get color() {
    return LooseGooseyField.values.find((value) => {
      return value.label === this.label;
    })?.color;
  }
}

export interface LooseyGooseyData {
  index: number;
  label: string;
  color?: string;
}

class Edit extends Component<typeof TaskStatusField> {
  @tracked label: string | undefined = this.args.model.label;
  <template>
    <BoxelSelect
      @placeholder={{this.placeholder}}
      @options={{this.statuses}}
      @selected={{this.selectedStatus}}
      @onChange={{this.onSelectStatus}}
      as |item|
    >
      <div> {{item.label}}</div>
    </BoxelSelect>
  </template>

  get selectedStatus() {
    return this.statuses.find((status) => {
      return status.label === this.label;
    });
  }

  get statuses() {
    return TaskStatusField.values;
  }

  @action onSelectStatus(status: LooseyGooseyData): void {
    this.label = status.label;
    this.args.model.label = this.selectedStatus?.label;
    this.args.model.index = this.selectedStatus?.index;
  }

  get placeholder() {
    return 'Fill in';
  }
}

export class TaskStatusField extends LooseGooseyField {
  static values = [
    { index: 0, label: 'Backlog', color: '#B0BEC5' },
    {
      index: 1,
      label: 'Next Sprint',
      color: '#64B5F6',
    },
    {
      index: 2,
      label: 'Current Sprint',
      color: '#00BCD4',
    },
    {
      index: 3,
      label: 'In Progress',
      color: '#FFB74D',
    },
    {
      index: 4,
      label: 'In Review',
      color: '#9575CD',
    },
    {
      index: 5,
      label: 'Staged',
      color: '#26A69A',
    },
    {
      index: 6,
      label: 'Shipped',
      color: '#66BB6A',
    },
  ];

  static embedded = class Embedded extends Component<typeof TaskStatusField> {
    <template>
      {{@model.label}}
    </template>
  };

  static edit = Edit;
}

class EditPriority extends Component<typeof TaskPriorityField> {
  @tracked label = this.args.model.label;

  get priorities() {
    return TaskPriorityField.values;
  }

  get selectedPriority() {
    return this.priorities?.find((priority) => {
      return priority.label === this.label;
    });
  }

  @action handlePriorityChange(priority: LooseyGooseyData): void {
    this.label = priority.label;
    this.args.model.label = this.selectedPriority?.label;
    this.args.model.index = this.selectedPriority?.index;
  }

  <template>
    <div class='priority-field'>
      <RadioInput
        @groupDescription='Select Task Priority'
        @items={{this.priorities}}
        @checkedId={{this.selectedPriority.label}}
        @orientation='horizontal'
        @spacing='default'
        @keyName='label'
        as |item|
      >
        <item.component @onChange={{fn this.handlePriorityChange item.data}}>
          {{item.data.label}}
        </item.component>
      </RadioInput>
    </div>
  </template>
}

export class TaskPriorityField extends LooseGooseyField {
  // loosey goosey pattern
  static values = [
    { index: 0, label: 'Low' },
    {
      index: 1,
      label: 'Medium',
    },
    {
      index: 2,
      label: 'High',
    },
  ];

  static edit = EditPriority;
  static embedded = class Embedded extends Component<typeof TaskPriorityField> {
    <template>
      {{@model.label}}
    </template>
  };
}

export class User extends CardDef {
  static displayName = 'User';
  @field name = contains(StringField);
  @field email = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Team) {
      return this.name;
    },
  });
}

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

      {{! can be changed to scoped if needed }}
      {{! template-lint-disable require-scoped-style }}

      <style>
        .assignee-display {
          display: flex;
          align-items: center;
          background-color: var(--boxel-200);
          border-radius: 100px;
          overflow: hidden;
          max-width: 100px;
          width: fit-content;
        }
        .avatar {
          --profile-avatar-icon-size: 26px;
          --profile-avatar-icon-border: 0px;
          flex-shrink: 0;
        }
        .assignee-name {
          font-size: 12px;
          font-weight: 500;
          padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-xxxs);
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

class Fitted extends Component<typeof Task> {
  get visibleTags() {
    if (!this.args.model.tags) return [];
    return this.args.model.tags.slice(0, 3);
  }

  get hasMoreTags() {
    if (!this.args.model.tags) return false;
    return this.args.model.tags.length > 3;
  }

  get remainingTagsCount() {
    if (!this.args.model.tags) return '';
    return this.args.model.tags.length - 3;
  }

  <template>
    <div class='task-card'>
      <div class='card-header'>
        <span class='short-id'>{{@model.shortId}}</span>
        <h3 class='task-title'>{{@model.taskName}}</h3>
      </div>

      <div class='card-info'>
        {{#if @model.assignee}}
          <@fields.assignee @format='atom' />
        {{/if}}

        {{#if @model.tags.length}}
          <div class='card-tags'>
            {{#each this.visibleTags as |tag|}}
              <Pill class='tag-pill' @pillBackgroundColor={{tag.color}}>
                <:default>
                  <span>{{tag.name}}</span>
                </:default>
              </Pill>
            {{/each}}
            {{#if this.hasMoreTags}}
              <span class='remaining-tags'>+{{this.remainingTagsCount}}</span>
            {{/if}}
          </div>
        {{/if}}
      </div>

      <div class='card-footer'>
        <Calendar width='14px' height='14px' class='calendar-icon' />

        {{#if @model.dueDate}}
          <time class='date-info' datetime='{{@model.dueDate}}'>
            <@fields.dueDate />
          </time>
        {{else}}
          <span class='no-date-info'>No Due Date Assigned</span>
        {{/if}}
      </div>
    </div>

    {{! template-lint-disable require-scoped-style }}
    <style>
      .card-info {
        position: relative;
        display: flex;
        flex-wrap: nowrap;
        align-items: stretch;
        gap: var(--boxel-sp-xxs);
        overflow-x: hidden;
      }
      .card-info .boundaries {
        box-shadow: none;
      }
      .card-info .field-component-card.atom-format.display-container-true {
        padding: 0;
        background-color: transparent;
        width: auto;
        height: auto;
        overflow: unset;
      }
      .card-assignee {
        display: inline-flex;
        align-items: center;
        overflow: hidden;
      }
    </style>
    <style scoped>
      .task-card {
        width: 100%;
        height: 100%;
        padding: var(--boxel-sp-sm);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        overflow: hidden;
      }
      .short-id {
        font-size: var(--boxel-font-size-xs);
        color: var(--boxel-red);
      }
      .task-title {
        margin: var(--boxel-sp-xxxs) 0 0 0;
        padding: 0;
        font-size: var(--boxel-font-size);
        font-weight: 600;
        line-height: 1.2;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .card-footer {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        color: var(--boxel-dark);
        margin-top: auto;
      }
      .calendar-icon {
        flex-shrink: 0;
      }
      .date-info {
        font-size: 10px;
        font-weight: 500;
        color: var(--boxel-600);
        line-height: 10px;
        white-space: nowrap;
        -webkit-line-clamp: 1;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .no-date-info {
        font-size: 10px;
        font-weight: 500;
        color: var(--boxel-400);
        line-height: 10px;
        white-space: nowrap;
        -webkit-line-clamp: 1;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .card-tags {
        display: flex;
        align-items: stretch;
        gap: var(--boxel-sp-xxs);
        flex: 1;
      }
      .tag-pill {
        font-size: 12px;
        padding: var(--boxel-sp-6xs) var(--boxel-sp-xxs);
        border: transparent;
        border-radius: 5px;
        overflow: hidden;
        max-width: 120px;
      }
      .tag-pill > span {
        white-space: nowrap;
        -webkit-line-clamp: 1;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .remaining-tags {
        display: inline-flex;
        align-items: center;
        justify-content: end;
        font-size: 12px;
        font-weight: 600;
        color: var(--boxel-500);
        position: absolute;
        right: 0;
        width: 50px;
        height: 100%;
        background: linear-gradient(to right, transparent 1%, white, white);
      }

      @container (height <= 29px) {
        .task-title,
        .card-info,
        .card-tags,
        .card-footer {
          display: none;
        }
      }

      @container fitted-card (1.0 > aspect-ratio) {
        .card-tags,
        .card-footer {
          display: none;
        }
        .task-card {
          display: flex;
          flex-direction: column;
        }
      }

      @container fitted-card (aspect-ratio < 0.9) and (width <= 100px) and (height <= 120px) {
        .task-card {
          padding: var(--boxel-sp-xxs);
          gap: var(--boxel-sp-xxs);
        }
        .card-info,
        .card-footer {
          display: none;
        }
        .task-title {
          -webkit-line-clamp: 1;
        }
      }

      @container fitted-card (aspect-ratio < 0.95) and (width <= 165px) and (height <= 225px) {
        .task-card {
          padding: var(--boxel-sp-xxs);
          gap: var(--boxel-sp-xxs);
        }
        .card-footer {
          display: inline-flex;
        }
        .card-tags {
          display: none;
        }
      }

      @container fitted-card (2.0 < aspect-ratio) {
        .task-card {
          padding: var(--boxel-sp-xxs);
        }
        .task-title {
          -webkit-line-clamp: 1;
        }
      }

      @container fitted-card (2.0 < aspect-ratio) and (height <= 115px) {
        .task-card {
          gap: var(--boxel-sp-xxs);
        }
        .card-footer {
          display: none;
        }
      }

      @container fitted-card (2.0 < aspect-ratio) and (aspect-ratio > 3.9) and (height <= 58px) {
        .task-card,
        .card-header {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        .card-info {
          margin-top: 0;
        }
        .card-footer {
          display: none;
        }
        .task-title {
          margin: 0;
          -webkit-line-clamp: 1;
        }
        .card-due-date-display,
        .card-tags {
          display: none;
        }
      }

      @container fitted-card (2.0 < aspect-ratio) and (width <= 150px) {
        .task-card,
        .card-header {
          align-items: center;
          justify-content: center;
        }
        .card-info,
        .task-title,
        .card-due-date-display,
        .card-tags {
          display: none;
        }
      }
    </style>
  </template>
}

export class Tag extends CardDef {
  static displayName = 'Tag';
  static icon = TagIcon;
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Tag) {
      return this.name;
    },
  });
  @field color = contains(StringField);

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

class TaskIsolated extends Component<typeof Task> {
  <template>
    <div class='task-card'>
      <div class='task-header'>
        <h2 class='task-title'>{{@model.taskName}}</h2>
        <Pill
          class='small-pill'
          style={{cssVar
            pill-font-color=@model.status.color
            pill-border-color=@model.status.color
          }}
        >
          <:default>
            {{@model.status.label}}
          </:default>
        </Pill>
      </div>
      <div class='task-detail'>
        {{@model.taskDetail}}
      </div>
      <div class='task-meta'>
        <div class='row-1'>
          {{#if @model.assignee}}
            <div class='task-assignee'>
              <Avatar
                class='avatar'
                @userId={{@model.assignee.id}}
                @displayName={{@model.assignee.name}}
                @isReady={{true}}
              />
              <span class='assignee-name'>
                {{@model.assignee.name}}
              </span>
            </div>
          {{/if}}
          {{#if this.hasDateRange}}
            <div class='task-dates'>
              <Calendar width='14px' height='14px' class='calendar-icon' />
              <span class='date-info'>
                <@fields.dateStarted />
                -
                <@fields.dueDate />
              </span>
            </div>
          {{/if}}

        </div>
        <div class='row-2'>
          {{#each this.tagNames as |tagLabel|}}
            <Pill class='tag-pill'>
              <:default>
                <span class='tag-dot'></span>
                {{tagLabel}}
              </:default>
            </Pill>
          {{/each}}
        </div>
      </div>
      {{#if this.hasChildren}}
        <div class='subtasks-section'>
          <div class='subtasks-header-container'>
            <h4 class='subtasks-header'>Subtasks ({{this.childrenCount}}
              child tasks)</h4>
            <div class='progress-bar-container'>
              <ProgressBar
                @label={{this.progressLabel}}
                @value={{this.progress}}
                @max={{100}}
              />
            </div>
          </div>
          <div class='subtasks-container'>
            <div class='status-column'>
              {{#each this.shippedArr as |isShipped|}}
                <div class='status-indicator'>
                  {{#if isShipped}}
                    <div class='circle completed'>
                      <CheckMark width='15px' height='15px' />
                    </div>
                  {{else}}
                    <div class='circle incomplete'></div>
                  {{/if}}
                </div>
              {{/each}}
            </div>
            <div class='children-column'>
              {{#each @fields.children as |ChildTask|}}
                <div class='subtask-item'>
                  <ChildTask />
                </div>
              {{/each}}
            </div>
          </div>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .task-card {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: 0 var(--boxel-sp);
      }
      .task-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
      }
      .task-detail {
        min-height: var(--boxel-form-control-height);
        margin-bottom: var(--boxel-sp-sm);
      }
      .task-meta {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .task-assignee {
        display: inline-flex;
        align-items: center;
        background-color: var(--boxel-200);
        border-radius: 100px;
        overflow: hidden;
      }
      .row-1 {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }
      .row-2 {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
      .progress-bar-container {
        --boxel-progress-bar-fill-color: var(--boxel-highlight);
        width: 35%;
        max-width: 400px;
      }

      .task-dates {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        color: var(--boxel-600);
      }
      .calendar-icon {
        flex-shrink: 0;
      }
      .date-info {
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
        color: var(--boxel-600);
        line-height: 10px;
      }
      .children-header {
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-purple);
        margin-bottom: var(--boxel-sp-xxs);
      }
      .subtasks-section {
        border-radius: var(--boxel-border-radius);
        min-width: 150px;
        max-width: 600px;
      }
      .subtasks-header-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .subtasks-header {
        padding: 0 var(--boxel-sp-xxs);
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-purple);
      }
      .subtasks-container {
        display: flex;
        gap: var(--boxel-sp-sm);
      }
      .status-column {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }
      .children-column {
        flex-grow: 1;
      }
      .status-indicator {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 65px; /* Increased height to match subtask-item */
      }
      .subtask-item {
        height: 65px; /* Set a fixed height for subtask items */
        width: 100%;
        display: flex;
        align-items: center;
      }
      .circle {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid var(--boxel-dark);
      }
      .circle.completed {
        background-color: var(--boxel-highlight);
      }
      .circle.incomplete {
        background-color: white;
      }
      .tag-pill {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }
      .tag-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: var(--boxel-purple);
      }
    </style>
  </template>

  get shippedArr() {
    return (
      this.args.model.children?.map(
        (child) => child.status.label === 'Shipped',
      ) ?? []
    );
  }

  @action
  isShipped(status: unknown): boolean {
    if (typeof status === 'string') {
      return status.includes('Shipped'); // checking for html content
    }
    return false;
  }

  get tagNames() {
    return this.args.model.tags?.map((tag) => tag.name) ?? [];
  }

  get hasDateRange() {
    return this.args.model.dateStarted && this.args.model.dueDate;
  }

  get progress() {
    if (!this.hasChildren) return 0;
    const shippedCount = this.args.model.children!.filter(
      (child) => child.status.label === 'Shipped',
    ).length;
    return Math.round((shippedCount / this.childrenCount) * 100);
  }

  get progressLabel() {
    return `${this.progress}%`;
  }

  get hasChildren() {
    return this.args.model.children && this.args.model.children.length > 0;
  }

  get childrenCount() {
    return this.args.model.children ? this.args.model.children.length : 0;
  }

  get shippedCount() {
    return this.args.model.children
      ? this.args.model.children.filter(
          (child) => child.status.label === 'Shipped',
        ).length
      : 0;
  }
}

export class Task extends CardDef {
  static displayName = 'Task';
  static icon = CheckboxIcon;
  @field shortId = contains(StringField, {
    computeVia: function (this: Task) {
      if (this.id) {
        let id = shortenId(extractId(this.id));
        let _shortId: string;
        if (this.team && this.team.shortName) {
          // computeds are hard to debug -- the logs only appear on the server. We need to always include a check for links
          _shortId = this.team.shortName + '-' + id;
        } else {
          _shortId = id;
        }
        return _shortId.toUpperCase();
      }
      return;
    },
  });
  @field taskName = contains(StringField);
  @field taskDetail = contains(TextAreaCard);
  @field status = contains(TaskStatusField);
  @field priority = contains(TaskPriorityField);
  @field assignee = linksTo(TeamMember);
  @field project = linksTo(Project);
  @field team = linksTo(Team);
  @field dateStarted = contains(DateField);
  @field dueDate = contains(DateField);
  @field children = linksToMany(() => Task);
  @field tags = linksToMany(() => Tag);
  @field title = contains(StringField, {
    computeVia: function (this: Task) {
      return this.taskName;
    },
  });

  static isolated = TaskIsolated;

  static atom = class Atom extends Component<typeof this> {
    <template>
      <div class='task-atom'>
        {{#if @model.assignee}}
          <div class='avatar-wrapper'>
            <Avatar
              @userId={{@model.assignee.id}}
              @displayName={{@model.assignee.name}}
              @isReady={{true}}
              class='avatar'
            />
          </div>
        {{/if}}
        <div class='task-title'>{{@model.taskName}}</div>
      </div>
      <style scoped>
        .task-atom {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xxxs);
        }
        .avatar-wrapper {
          display: inline-block;
        }
        .avatar {
          --profile-avatar-icon-size: 20px;
        }
        .task-title {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };

  static fitted = Fitted;
}
