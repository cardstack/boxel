import {
  CardDef,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api';

import TextAreaCard from 'https://cardstack.com/base/text-area';

import DateRangeField from './date-range-field';
import { Tag } from './tag';
import { User } from './user';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { RadioInput } from '@cardstack/boxel-ui/components';

import { LooseGooseyField, type LooseyGooseyData } from './loosey-goosey';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { isToday, isThisWeek, addWeeks } from 'date-fns';
import GlimmerComponent from '@glimmer/component';
import Calendar from '@cardstack/boxel-icons/calendar';
import ChevronsUp from '@cardstack/boxel-icons/chevrons-up';
import { Pill } from '@cardstack/boxel-ui/components';
import { CheckMark } from '@cardstack/boxel-ui/icons';

class Edit extends Component<typeof BaseTaskStatusField> {
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
    return BaseTaskStatusField.values;
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

export class BaseTaskStatusField extends LooseGooseyField {
  static values = [
    { index: 0, label: 'Not Started', color: '#B0BEC5' },
    {
      index: 1,
      label: 'In Progress',
      color: '#64B5F6',
    },
    {
      index: 2,
      label: 'Done',
      color: '#00BCD4',
    },
  ];

  static embedded = class Embedded extends Component<
    typeof BaseTaskStatusField
  > {
    <template>
      {{@model.label}}
    </template>
  };

  static edit = Edit;
}

export class FittedTask extends Component<typeof TaskBase> {
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
        {{!-- <TaskCompletionStatus @model={{@model}} /> --}}
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

class EditPriority extends Component<typeof BaseTaskPriority> {
  @tracked label = this.args.model.label;

  get priorities() {
    return BaseTaskPriority.values;
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

export class BaseTaskPriority extends LooseGooseyField {
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
  static embedded = class Embedded extends Component<typeof BaseTaskPriority> {
    <template>
      {{@model.label}}
    </template>
  };
}

export class TaskBase extends CardDef {
  static displayName = 'Task Base';
  @field taskName = contains(StringField);
  @field tags = linksToMany(() => Tag);
  @field dateRange = contains(DateRangeField);
  @field status = contains(BaseTaskStatusField);
  @field taskDetail = contains(TextAreaCard);
  @field assignee = linksTo(() => User);
  @field priority = contains(BaseTaskPriority);

  @field title = contains(StringField, {
    computeVia: function (this: TaskBase) {
      return this.taskName;
    },
  });

  @field shortId = contains(StringField, {
    computeVia: function (this: TaskBase) {
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

function getDueDateStatus(dueDateString: string | null) {
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
    completionLabel: string;
    statusLabel?: string;
  };
}

export class TaskCompletionStatus extends GlimmerComponent<TaskCompletionStatusSignature> {
  get isCompleted() {
    return this.args.statusLabel === this.args.completionLabel;
  }

  <template>
    <div class='completion-status'>
      <span class='checkmark {{if this.isCompleted @completionLabel}}'>
        {{#if this.isCompleted}}
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
