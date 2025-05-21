import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import GlimmerComponent from '@glimmer/component';
import { BoxelSelect, Pill, RadioInput } from '@cardstack/boxel-ui/components';
import { CheckMark } from '@cardstack/boxel-ui/icons';
import Calendar from '@cardstack/boxel-icons/calendar';
import ChevronDown from '@cardstack/boxel-icons/chevrons-down';
import ChevronUp from '@cardstack/boxel-icons/chevron-up';
import ChevronsDown from '@cardstack/boxel-icons/chevrons-down';
import ChevronsUp from '@cardstack/boxel-icons/chevrons-up';
import CircleEqual from '@cardstack/boxel-icons/circle-equal';
import { addWeeks, isThisWeek, isToday } from 'date-fns';
import BooleanField from 'https://cardstack.com/base/boolean';
import ColorField from 'https://cardstack.com/base/color';
import DateRangeField from 'https://cardstack.com/base/date-range-field';
import NumberField from 'https://cardstack.com/base/number';
import {
  Component,
  FieldDef,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { Tag } from './tag';
import { Todo } from './todo';
import { User } from './user';

export class TaskStatusEdit extends Component<typeof TaskStatusField> {
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

  // This ensures you get values from the class the instance is created
  get statuses() {
    return (this.args.model.constructor as any).values as TaskStatusField[];
  }

  @action onSelectStatus(status: TaskStatusField): void {
    this.label = status.label;
    this.args.model.label = this.selectedStatus?.label;
    this.args.model.index = this.selectedStatus?.index;
    this.args.model.color = this.selectedStatus?.color;
    this.args.model.completed = this.selectedStatus?.completed;
  }

  get placeholder() {
    return 'Fill in';
  }
}

export class TaskStatusField extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  @field color = contains(ColorField);
  @field completed = contains(BooleanField);
  static values = [
    { index: 0, label: 'Not Started', color: '#B0BEC5', completed: false },
    {
      index: 1,
      label: 'In Progress',
      color: '#64B5F6',
      completed: false,
    },
    {
      index: 2,
      label: 'Done',
      color: '#00BCD4',
      completed: true,
    },
  ];

  static embedded = class Embedded extends Component<typeof TaskStatusField> {
    <template>
      {{@model.label}}
    </template>
  };

  //TODO: Not static. Need to improve ability to extend field templates
  static edit = TaskStatusEdit;
}

export class FittedTask extends Component<typeof Task> {
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

  <template>
    <div class='task-card'>
      <header>
        <div class='task-status-and-tags-container'>
          <TaskCompletionStatus
            class='task-completion-status'
            @completed={{this.isCompleted}}
          />
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
        </div>
        <div class='priority-and-id-container'>
          <@fields.priority class='priority' @format='atom' />
          <span class='short-id'>{{@model.shortId}}</span>
        </div>
      </header>

      <div class='card-info'>
        {{#if @model.name}}
          <h3 class='task-title'>{{@model.name}}</h3>
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
        {{!TODO: Actually, this shudn't be needed. atom default templates can't handle null values }}
        {{#if @model.assignee}}
          <@fields.assignee
            class='card-assignee'
            @format='atom'
            @displayContainer={{false}}
          />
        {{/if}}
      </footer>
    </div>

    <style scoped>
      .task-status-and-tags-container {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        flex-shrink: 0;
      }
      .task-completion-status {
        --boxel-circle-size: 14px;
        --boxel-border-radius: var(--boxel-border-radius-xxs);
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
        line-height: 1;
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
      .priority-and-id-container {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
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
        --entity-display-align-items: center;
      }
      /*catch all for dismissing tags*/
      @container fitted-card (width <= 226px) {
        .card-tags {
          display: none;
        }
      }
      /*Aspect Ratio 0.95, 140px × 148px*/
      /*Aspect Ratio 0.94, 120px × 128px*/
      @container fitted-card (aspect-ratio <1.0) and (118px <= height < 129px) {
        .priority,
        .date-info-container {
          display: none;
        }
        header {
          flex-wrap: nowrap;
        }
      }
      /*Aspect Ratio 3.4, 100px × 29px*/
      /*Aspect Ratio 2.6, 150px × 58px*/
      @container (aspect-ratio > 2.0) and (100px <= width <151px) and (29px <= height < 59px) {
        .task-card {
          padding: var(--boxel-sp-xxxs);
          flex-direction: row;
          align-items: center;
          gap: var(--boxel-sp-sm);
        }
        .task-title,
        .priority,
        .date-info-container {
          display: none;
        }
        header {
          flex-wrap: nowrap;
        }
        .card-assignee {
          display: none;
        }
      }
      /*Aspect Ratio 3.9, 226px × 58px*/
      /*Aspect Ratio 2.6, 300px × 115px*/
      @container (aspect-ratio > 2.0) and (151px <= width < 301px) and (29px <= height < 116px) {
        .task-title {
          font-size: var(--boxel-font-size-sm);
          -webkit-line-clamp: 1;
        }
        .task-card {
          padding: var(--boxel-sp-xxxs);
          flex-direction: row;
          align-items: center;
          gap: var(--boxel-sp-sm);
        }
        .priority {
          display: none;
        }
        header {
          flex-wrap: nowrap;
        }
        .date-info-container .date-status-pill {
          display: none;
        }
        .card-assignee {
          display: none;
        }
      }
      /*Aspect Ratio 8.6, 500px × 58px*/
      @container fitted-card (aspect-ratio > 6.0) {
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
        }
        footer {
          margin-top: 0;
          margin-left: auto;
        }
        .task-completion-status {
          --boxel-circle-size: 18px;
          --boxel-border-radius: var(--boxel-border-radius-xs);
        }
      }
    </style>
  </template>
}

class EditPriority extends Component<typeof TaskPriority> {
  @tracked label = this.args.model.label;

  get priorities() {
    return TaskPriority.values;
  }

  get selectedPriority() {
    return this.priorities?.find((priority) => {
      return priority.label === this.label;
    });
  }

  @action handlePriorityChange(priority: TaskPriority): void {
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

export class TaskPriority extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  static values = [
    { index: 0, label: 'Lowest', icon: ChevronsDown },
    { index: 1, label: 'Low', icon: ChevronDown },
    {
      index: 2,
      label: 'Medium',
      icon: CircleEqual,
    },
    {
      index: 3,
      label: 'High',
      icon: ChevronUp,
    },
    {
      index: 4,
      label: 'Highest',
      icon: ChevronsUp,
    },
  ];

  static edit = EditPriority;
  static embedded = class Embedded extends Component<typeof TaskPriority> {
    <template>
      {{@model.label}}
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get selectedPriority() {
      return TaskPriority.values.find((priority) => {
        return priority.label === this.args.model.label;
      });
    }

    get selectedIcon() {
      return this.selectedPriority?.icon;
    }
    <template>
      <div class='icon-container'>
        <this.selectedIcon width='14px' height='14px' />
      </div>
      <style scoped>
        .icon-container {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
        }
      </style>
    </template>
  };
}

export class Task extends Todo {
  static displayName = 'Task';
  @field tags = linksToMany(() => Tag);
  @field dateRange = contains(DateRangeField);
  @field status = contains(TaskStatusField);
  @field assignee = linksTo(() => User);
  @field priority = contains(TaskPriority);

  @field title = contains(StringField, {
    computeVia: function (this: Task) {
      return this.name ?? `Untitled ${this.constructor.displayName}`;
    },
  });

  @field shortId = contains(StringField, {
    computeVia: function (this: Task) {
      if (this.id) {
        let id = shortenId(extractId(this.id));
        return id.toUpperCase();
      }
      return;
    },
  });

  static fitted = FittedTask;
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

export function getDueDateStatus(dueDateString: string | null) {
  if (!dueDateString) return null;

  const dueDate = new Date(dueDateString);
  const today = new Date();
  const nextWeek = addWeeks(today, 1);

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

interface TaskCompletionStatusSignature {
  Element: HTMLDivElement;
  Args: {
    completed: boolean;
  };
}

export class TaskCompletionStatus extends GlimmerComponent<TaskCompletionStatusSignature> {
  <template>
    <div class='completion-status' ...attributes>
      <span class='checkmark {{if @completed "completed"}}'>
        {{#if @completed}}
          <CheckMark class='checkmark-icon' />
        {{/if}}
      </span>
    </div>

    <style scoped>
      .completion-status {
        --circle-size: var(--boxel-circle-size, 20px);
        --border-radius: var(
          --boxel-border-radius,
          var(--boxel-border-radius-xxs)
        );
        display: inline-flex;
        align-items: center;
      }
      .checkmark {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        height: var(--circle-size);
        width: var(--circle-size);
        background-color: white;
        border: 2px solid var(--boxel-400);
        border-radius: var(--border-radius);
        transition: all 0.2s ease;
      }
      .checkmark.completed {
        background-color: var(--boxel-highlight);
        color: white;
      }
      .checkmark-icon {
        --icon-size: calc(var(--circle-size, 20px) * 0.8);
        width: var(--icon-size);
        height: var(--icon-size);
      }
    </style>
  </template>
}
