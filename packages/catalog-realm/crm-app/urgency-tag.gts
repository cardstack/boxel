import {
  FieldDef,
  field,
  contains,
  StringField,
  Component,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import ColorField from 'https://cardstack.com/base/color';

import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { BoxelSelect } from '@cardstack/boxel-ui/components';

import { StatusPill } from './components/status-pill';

import ClockExclamation from '@cardstack/boxel-icons/clock-exclamation';
import Clock24 from '@cardstack/boxel-icons/clock-24';
import Handshake from '@cardstack/boxel-icons/handshake';
import ClockX from '@cardstack/boxel-icons/clock-x';
import ClockUp from '@cardstack/boxel-icons/clock-up';
import Contract from '@cardstack/boxel-icons/contract';
import CalendarTime from '@cardstack/boxel-icons/calendar-time';
import CalendarExclamation from '@cardstack/boxel-icons/calendar-exclamation';

export const URGENCY_TAG_VALUES = [
  {
    index: 0,
    icon: ClockExclamation,
    label: 'Overdue for Renewal',
    value: 'overdue-for-renewal',
    buttonText: 'Create Account', // TODO: For the createNewButtonText usage in CRM App
    foregroundColor: '#D32F2F', // Dark Red
    backgroundColor: '#FFEBEE', // Light Red
  },
  {
    index: 1,
    icon: Clock24,
    label: 'Renewal Due Soon',
    foregroundColor: '#F57C00', // Dark Orange
    backgroundColor: '#FFF3E0', // Light Orange
  },
  {
    index: 2,
    icon: Handshake,
    label: 'Recently Renewed',
    foregroundColor: '#388E3C', // Dark Green
    backgroundColor: '#E8F5E9', // Light Green
  },
  {
    index: 3,
    icon: ClockX,
    label: 'Expiring Soon',
    foregroundColor: '#FBC02D', // Dark Yellow
    backgroundColor: '#FFF9C4', // Light Yellow
  },
  {
    index: 4,
    icon: ClockUp,
    label: 'Follow-Up Required',
    foregroundColor: '#1976D2', // Dark Blue
    backgroundColor: '#E3F2FD', // Light Blue
  },
  {
    index: 5,
    icon: Contract,
    label: 'Pending Contract',
    foregroundColor: '#512DA8', // Dark Purple
    backgroundColor: '#EDE7F6', // Light Purple
  },
  {
    index: 6,
    icon: CalendarTime,
    label: 'Next Review Scheduled',
    foregroundColor: '#558B2F', // Dark Olive Green
    backgroundColor: '#F1F8E9', // Light Olive Green
  },
];

class UrgencyTagEdit extends Component<typeof UrgencyTag> {
  @tracked label: string | undefined = this.args.model.label;

  get statuses() {
    if (!this.args.model) {
      return [];
    }
    return (this.args.model.constructor as any).values;
  }
  get selectedStatus() {
    return this.statuses.find((status: UrgencyTag) => {
      return status.label === this.label;
    });
  }

  @action onSelectStatus(status: UrgencyTag): void {
    this.label = status.label;
    this.args.model.label = this.selectedStatus?.label;
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

export class UrgencyTag extends FieldDef {
  static icon = CalendarExclamation;
  static displayName = 'Urgency Tag';
  static values = URGENCY_TAG_VALUES;
  @field index = contains(NumberField);
  @field label = contains(StringField);
  @field foregroundColor = contains(ColorField);
  @field backgroundColor = contains(ColorField);

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.label}}
        <StatusPill
          @label={{@model.label}}
          @icon={{@model.constructor.icon}}
          @iconDarkColor={{@model.foregroundColor}}
          @iconLightColor={{@model.backgroundColor}}
        />
      {{/if}}
    </template>
  };

  static edit = UrgencyTagEdit;
}
