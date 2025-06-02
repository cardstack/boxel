import {
  FieldDef,
  field,
  contains,
  StringField,
  Component,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import ColorField from 'https://cardstack.com/base/color';

import { BoxelSelect } from '@cardstack/boxel-ui/components';

import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

class DealPriorityEdit extends Component<typeof DealPriority> {
  @tracked label: string | undefined = this.args.model.label;

  get statuses() {
    if (!this.args.model) {
      return [];
    }
    return (this.args.model.constructor as any).values;
  }

  get selectedStatus() {
    return this.statuses.find((status: DealPriority) => {
      return status.label === this.label;
    });
  }

  @action onSelectStatus(status: DealPriority): void {
    this.label = status.label;
    this.args.model.label = this.selectedStatus?.label;
    this.args.model.index = this.selectedStatus?.index;
    this.args.model.foregroundColor = this.selectedStatus?.foregroundColor;
    this.args.model.backgroundColor = this.selectedStatus?.backgroundColor;
  }

  get placeholder() {
    if (this.args.model?.constructor?.displayName) {
      return `Fill in ${this.args.model?.constructor?.displayName}`;
    }
    return 'Fill in';
  }

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
}

export class DealPriority extends FieldDef {
  static displayName = 'CRM Deal Priority';
  @field index = contains(NumberField);
  @field label = contains(StringField);
  @field foregroundColor = contains(ColorField);
  @field backgroundColor = contains(ColorField);

  static values = [
    {
      index: 0,
      label: 'Low Priority',
      foregroundColor: '#000000',
      backgroundColor: '#E3F2FD',
    },
    {
      index: 1,
      label: 'Medium Priority',
      foregroundColor: '#000000',
      backgroundColor: '#FFF0B3',
    },
    {
      index: 2,
      label: 'High Priority',
      foregroundColor: '#000000',
      backgroundColor: '#FFD800',
    },
  ];

  static edit = DealPriorityEdit;
}
