import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import PhoneIcon from '@cardstack/boxel-icons/phone';
import { EntityDisplay } from './components/entity-display';
import {
  BoxelSelect,
  FieldContainer,
  Pill,
} from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';

interface PhoneTypeArgs {
  type: string;
  label: string;
}

class EditTemplate extends Component<typeof PhoneField> {
  get options() {
    return [
      {
        type: 'mobile',
        label: 'Mobile',
      },
      {
        type: 'office',
        label: 'Office',
      },
    ] as PhoneTypeArgs[];
  }

  get selectedOption() {
    return this.options?.find((option) => option.type === this.args.model.type);
  }

  @action
  onSelect(option: PhoneTypeArgs) {
    this.args.model.type = option.type;
  }

  <template>
    <FieldContainer @vertical={{true}} @label='Type'>
      <BoxelSelect
        @options={{this.options}}
        @selected={{this.selectedOption}}
        @onChange={{this.onSelect}}
        @placeholder='Please Select'
        as |item|
      >
        <div>{{item.label}}</div>
      </BoxelSelect>
    </FieldContainer>

    <FieldContainer @vertical={{true}} @label='Country'>
      <@fields.country />
    </FieldContainer>

    <FieldContainer @vertical={{true}} @label='Area'>
      <@fields.area />
    </FieldContainer>

    <FieldContainer @vertical={{true}} @label='Number'>
      <@fields.number />
    </FieldContainer>
  </template>
}

export class PhoneField extends FieldDef {
  static displayName = 'phoneMobile';

  @field type = contains(StringField);
  @field country = contains(NumberField);
  @field area = contains(NumberField);
  @field number = contains(NumberField);

  @field phoneNumber = contains(StringField, {
    computeVia: function (this: PhoneField) {
      return [this.country, this.area, this.number].filter(Boolean).join('-');
    },
  });

  static edit = EditTemplate;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.phoneNumber />
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.phoneNumber}}
        <EntityDisplay @name={{@model.phoneNumber}} @underline={{false}}>
          <:thumbnail>
            <PhoneIcon class='icon' />
          </:thumbnail>
          <:tag>
            <Pill class='pill-gray'>
              {{@model.type}}
            </Pill>
          </:tag>
        </EntityDisplay>
      {{/if}}
      <style scoped>
        .icon {
          color: var(--boxel-400);
        }
        .pill-gray {
          background-color: var(--boxel-200);
          border-color: transparent;
        }
      </style>
    </template>
  };
}
