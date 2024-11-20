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
  ProgressRadial,
} from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import TextAreaCard from '../../base/text-area';
import FolderGitIcon from '@cardstack/boxel-icons/folder-git';
import TagIcon from '@cardstack/boxel-icons/tag';
import CheckboxIcon from '@cardstack/boxel-icons/checkbox';
import UsersIcon from '@cardstack/boxel-icons/users';
import UserIcon from '@cardstack/boxel-icons/user';
import Calendar from '@cardstack/boxel-icons/calendar';
import { isToday, isThisWeek, addWeeks } from 'date-fns';
import ChevronsUp from '@cardstack/boxel-icons/chevrons-up';
import { CheckMark } from '@cardstack/boxel-ui/icons';
import GlimmerComponent from '@glimmer/component';
import DateRangeField from './date-range-field';

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

interface TaskCompletionStatusSignature {
  Element: HTMLDivElement;
  Args: {
    model: Task | Partial<Task>;
  };
}

class TaskCompletionStatus extends GlimmerComponent<TaskCompletionStatusSignature> {
  get isShipped() {
    return this.args.model.status?.label === 'Shipped';
  }

  <template>
    <div class='completion-status'>
      <span class='checkmark {{if this.isShipped "shipped"}}'>
        {{#if this.isShipped}}
          <CheckMark width='16px' height='16px' />
        {{/if}}
      </span>
    </div>

    <style scoped>
      .completion-status {
        display: inline-flex;
        align-items: center;
      }
      .checkmark {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 20px;
        width: 20px;
        background-color: white;
        border: 2px solid var(--boxel-400);
        border-radius: 4px;
        transition: all 0.2s ease;
      }
      .checkmark.shipped {
        background-color: var(--boxel-highlight);
        color: white;
      }
    </style>
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

function getDueDateStatus(dueDateString: string | null) {
  if (!dueDateString) return null;

  const dueDate = new Date(dueDateString);
  const today = new Date();
  const nextWeek = addWeeks(dueDate, 1);

  if (isToday(dueDate)) {
    return {
      label: 'Due Today',
      color: '#01de67',
    };
  } else if (isThisWeek(dueDate)) {
    return {
      label: 'This Week',
      color: '#ffbc00',
    };
  } else if (dueDate > today && dueDate < nextWeek) {
    return {
      label: 'Next Week',
      color: '#4fc8fd',
    };
  }

  return null;
}

class Fitted extends Component<typeof Task> {
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

  <template>
    <div class='task-card'>
      <div class='task-completion-status'>
        <TaskCompletionStatus @model={{@model}} />
      </div>

      <header>
        {{#if this.visibleTags.length}}
          <div class='card-tags'>
            {{#each this.visibleTags as |Tag|}}
              <Tag
                @format='atom'
                class='card-tag'
                @displayContainer={{false}}
              />
            {{/each}}
          </div>
        {{/if}}
        <div class='short-id-container'>
          <ChevronsUp width='14px' height='14px' />
          <span class='short-id'>{{@model.shortId}}</span>
        </div>
      </header>

      <div class='card-info'>
        {{#if @model.taskName}}
          <h3 class='task-title'>{{@model.taskName}}</h3>
        {{/if}}

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
                <Calendar width='14px' height='14px' class='calendar-icon' />
                <@fields.dateRange.end @format='atom' />
              </div>
            </div>
          {{else}}
            <span class='no-data-found-txt'>No Due Date Assigned</span>
          {{/if}}
        </div>
      </div>

      <footer>
        <@fields.assignee
          class='card-assignee'
          @format='atom'
          @displayContainer={{false}}
        />
      </footer>
    </div>

    <style scoped>
      .task-completion-status {
        display: none;
      }
      .task-card {
        --task-font-weight-500: 500;
        --task-font-weight-600: 600;
        --tasl-font-size-extra-small: calc(var(--boxel-font-size-xs) * 0.95);
        width: 100%;
        height: 100%;
        padding: var(--boxel-sp-sm);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        overflow: hidden;
      }
      header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        justify-content: space-between;
      }
      .card-tags {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        overflow: hidden;
      }
      .card-tag {
        width: auto;
        height: auto;
        overflow: unset;
      }
      .card-tags > :last-child {
        -webkit-line-clamp: 1;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .short-id-container {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-3xs);
        margin-left: auto;
      }
      .short-id {
        font-size: var(--tasl-font-size-extra-small);
        font-weight: var(--task-font-weight-600);
        color: var(--boxel-600);
        line-height: normal;
        background-color: var(--boxel-200);
        padding: var(--boxel-sp-6xs) var(--boxel-sp-xxs);
        border-radius: 5px;
        white-space: nowrap;
      }
      .task-title {
        margin: var(--boxel-sp-xxxs) 0;
        padding: 0;
        font-size: var(--boxel-font-size);
        font-weight: var(--task-font-weight-600);
        line-height: 1.2;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .date-info-container {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        margin-top: var(--boxel-sp-xxxs);
      }
      .no-data-found-txt {
        font-size: var(--tasl-font-size-extra-small);
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
        gap: var(--boxel-sp-xxxs);
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
      footer {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        color: var(--boxel-dark);
        margin-top: auto;
      }
      .card-assignee {
        width: auto;
        height: auto;
        overflow: unset;
        margin-left: auto;
      }

      /* Square/Portrait Container (aspect-ratio <= 1.0) */
      @container (aspect-ratio <= 1.0) {
        .task-card {
          padding: var(--boxel-sp-xs);
        }

        .date-status-pill {
          display: none;
        }

        footer {
          margin-top: auto;
        }
      }

      /* Compact Portrait (height <= 230px) */
      @container (aspect-ratio <= 1.0) and (height <=230px) {
        .task-card {
          gap: var(--boxel-sp-5xs);
        }

        .task-title {
          -webkit-line-clamp: 1;
        }

        .card-tags {
          display: none;
        }
      }

      /* Landscape Container (1.0 < aspect-ratio <= 2.0) */
      @container (1.0 < aspect-ratio <= 2.0) {
        .task-card {
          padding: var(--boxel-sp-sm);
        }
      }

      /* Extra styles for very narrow height but medium*/
      @container (aspect-ratio < 2.0) and (height <= 78px) {
        .task-title {
          -webkit-line-clamp: 1;
        }

        .card-tags,
        .date-info-container {
          display: none;
        }
      }

      /* Extra styles for width <= 150px and height <= 100px */
      @container (width <= 150px) and (height <= 100px) {
        .card-tags,
        .card-info,
        footer {
          display: none;
        }
      }

      /* Extra styles for width > 280px and height 78px */
      @container (width > 280px) and (height <= 78px) {
        .task-completion-status {
          display: inline-flex;
        }
      }

      @container (aspect-ratio > 2.0) and (height <= 78px) {
        .task-card {
          padding: var(--boxel-sp-xs);
          flex-direction: row;
          align-items: center;
          gap: var(--boxel-sp-sm);
        }

        .card-tags,
        .date-info-container {
          display: none;
        }
        .task-title {
          font-size: var(--boxel-font-size-sm);
          -webkit-line-clamp: 1;
        }
      }

      /* Extra styles for small size */
      @container (width <= 400px) and (height <= 58px) {
        footer {
          display: none;
        }
      }

      /* Extra styles for super narrow height */
      @container (aspect-ratio > 6.0) and (height <= 78px) {
        .task-card {
          padding: var(--boxel-sp-xs);
        }

        .card-tags,
        .date-info-container {
          display: none;
        }

        .task-title {
          font-size: var(--boxel-font-size-sm);
        }

        footer {
          margin-top: 0;
          margin-left: auto;
        }
      }

      /* Wide Container (aspect-ratio > 2.0) */
      @container (aspect-ratio > 2.0) {
        .task-card {
          gap: var(--boxel-sp-xxxs);
        }

        .task-title {
          -webkit-line-clamp: 1;
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
      {{#if @model.name}}
        <Pill class='tag-pill' @pillBackgroundColor={{@model.color}}>
          <:default>
            <span># {{@model.name}}</span>
          </:default>
        </Pill>
      {{/if}}

      <style scoped>
        .tag-pill {
          font-size: calc(var(--boxel-font-size-xs) * 0.95);
          font-weight: 500;
          padding: 0;
          --pill-font-color: var(--boxel-400);
          border: none;
        }
      </style>
    </template>
  };
}

class TaskIsolated extends Component<typeof Task> {
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
          <h2 class='task-title'>{{@model.taskName}}</h2>
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
          {{#if @model.taskDetail}}
            <p>{{@model.taskDetail}}</p>
          {{else}}
            <span class='no-data-found-txt'>No Task Description Provided</span>
          {{/if}}
        </div>

        <div class='right-column'>
          <div class='assignees'>
            <h4>Assignees</h4>

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
        <h4>Subtasks ({{@model.children.length}})</h4>

        {{#if @model.children}}
          <@fields.children @format='fitted' />
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
        font-size: var(--boxel-font-size-med);
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
    const shippedCount = this.args.model.children!.filter(
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
  @field children = linksToMany(() => Task);
  @field tags = linksToMany(() => Tag);
  @field dateRange = contains(DateRangeField);
  @field title = contains(StringField, {
    computeVia: function (this: Task) {
      return this.taskName;
    },
  });

  static isolated = TaskIsolated;

  static fitted = Fitted;
}
