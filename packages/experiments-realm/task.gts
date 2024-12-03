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
