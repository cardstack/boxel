import {
  FieldDef,
  field,
  contains,
  StringField,
  Component,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import ColorField from 'https://cardstack.com/base/color';

import FilterSearch from '@cardstack/boxel-icons/filter-search';
import FilePen from '@cardstack/boxel-icons/file-pen';
import ArrowLeftRight from '@cardstack/boxel-icons/arrow-left-right';
import Award from '@cardstack/boxel-icons/award';
import AwardOff from '@cardstack/boxel-icons/award-off';

import {
  BoxelSelect,
  EntityDisplayWithIcon,
} from '@cardstack/boxel-ui/components';

import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

export const DEAL_STATUS_VALUES = [
  {
    index: 0,
    icon: FilterSearch,
    label: 'Discovery',
    foregroundColor: '#D32F2F', // Dark Red
    backgroundColor: '#FFEBEE', // Light Red
  },
  {
    index: 1,
    icon: FilePen,
    label: 'Proposal',
    foregroundColor: '#000000',
    backgroundColor: '#A66DFA',
  },
  {
    index: 2,
    icon: ArrowLeftRight,
    label: 'Negotiation',
    foregroundColor: '#000000',
    backgroundColor: '#FFF3E0', // light orange
  },
  {
    index: 3,
    icon: Award,
    label: 'Closed Won',
    buttonText: 'Create Deal',
    foregroundColor: '#000000',
    backgroundColor: '#E8F5E9', // light green
  },
  {
    index: 4,
    icon: AwardOff,
    label: 'Closed Lost',
    buttonText: 'Create Deal',
    foregroundColor: '#000000',
    backgroundColor: '#FFEBEE', // light red
  },
];

class DealStatusEdit extends Component<typeof DealStatus> {
  @tracked label: string | undefined = this.args.model.label;

  get statuses() {
    if (!this.args.model) {
      return [];
    }
    return (this.args.model.constructor as any).values;
  }

  get selectedStatus() {
    return this.statuses.find((status: DealStatus) => {
      return status.label === this.label;
    });
  }

  @action onSelectStatus(status: DealStatus): void {
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

export class DealStatus extends FieldDef {
  static displayName = 'CRM Deal Status';
  @field index = contains(NumberField);
  @field label = contains(StringField);
  @field foregroundColor = contains(ColorField);
  @field backgroundColor = contains(ColorField);

  static values = DEAL_STATUS_VALUES;

  static atom = class Atom extends Component<typeof this> {
    get statusData() {
      return DEAL_STATUS_VALUES.find(
        (status) => status.label === this.args.model.label,
      );
    }

    <template>
      {{#if @model.label}}
        <EntityDisplayWithIcon @title={{@model.label}}>
          <:icon>
            {{this.statusData.icon}}
          </:icon>
        </EntityDisplayWithIcon>
      {{/if}}
    </template>
  };

  static edit = DealStatusEdit;
}
