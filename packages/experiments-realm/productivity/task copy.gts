//Working copy of task after getting ember select to work
import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

export class StatusField extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  // @field statuses = containsMany(StatuField)
  // bcos we don't have guides we have to repeat the statuses array filling up

  statuses: StatusFieldData[] = []; //help with the types
}

interface StatusFieldData {
  index?: number;
  label?: string;
}

class Edit extends Component<typeof StatusField> {
  @tracked label: string | undefined = this.args.model.label;
  //we can optionally track the selectedStatus here, but we must
  // ensure we choose do not create a separate instance of object in options

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
    return this.statuses?.find((status) => {
      return status.label === this.label;
    });
  }

  get statuses() {
    return this.args.model?.statuses;
  }

  @action onSelectStatus(status: StatusFieldData): void {
    this.label = status.label;
    this.args.model.label = this.selectedStatus?.label;
    this.args.model.index = this.selectedStatus?.index;
  }

  get placeholder() {
    return 'Fill in';
  }
}

export class TaskStatusField extends StatusField {
  // loosey goosey pattern

  statuses = [
    { index: 0, label: 'To Do' },
    {
      index: 1,
      label: 'In Progress',
    },
    {
      index: 2,
      label: 'Done',
    },
  ];

  static edit = Edit;
}

export class TaskPriorityField extends StatusField {
  // loosey goosey pattern

  statuses = [
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

  static edit = Edit;
}

export class Task extends CardDef {
  static displayName = 'Task';
  @field status = contains(TaskStatusField);
  @field priority = contains(TaskPriorityField);
}
