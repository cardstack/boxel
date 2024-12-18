import {
  contains,
  field,
  Component,
  FieldDef,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { LooseGooseyField, LooseyGooseyData } from './loosey-goosey';
import { PhoneInput, Pill } from '@cardstack/boxel-ui/components';
import { RadioInput } from '@cardstack/boxel-ui/components';
import { EntityDisplay } from './components/entity-display';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import PhoneIcon from '@cardstack/boxel-icons/phone';

class PhoneNumberTypeEdit extends Component<typeof PhoneNumberType> {
  @tracked label: string | undefined = this.args.model.label;

  get types() {
    return PhoneNumberType.values;
  }

  get selected() {
    return this.types?.find((type) => {
      return type.label === this.label;
    });
  }

  @action onSelect(type: LooseyGooseyData): void {
    this.label = type.label;
    this.args.model.label = this.selected?.label;
    this.args.model.index = this.selected?.index;
  }
  <template>
    <RadioInput
      @groupDescription='Office, Work, Home '
      @items={{this.types}}
      @checkedId={{this.selected.label}}
      @orientation='horizontal'
      @spacing='default'
      @keyName='label'
      as |item|
    >
      <item.component @onChange={{fn this.onSelect item.data}}>
        {{item.data.label}}
      </item.component>
    </RadioInput>
  </template>
}

export class PhoneNumberType extends LooseGooseyField {
  static displayName = 'Phone Number Type';
  static values = [
    { index: 0, label: 'Mobile' },
    { index: 1, label: 'Home' },
    { index: 2, label: 'Work' },
  ];
  static edit = PhoneNumberTypeEdit;
}

export class PhoneField extends FieldDef {
  static displayName = 'Phone Number';
  @field number = contains(StringField);
  @field countryCode = contains(StringField);

  setNumber = (number: string) => {
    this.number = number;
  };

  setCountryCode = (code: string) => {
    this.countryCode = code;
  };

  static edit = class Edit extends Component<typeof PhoneField> {
    <template>
      <PhoneInput
        @countryCode={{@model.countryCode}}
        @value={{@model.number}}
        @onInput={{@model.setNumber}}
        @onCountryCodeChange={{@model.setCountryCode}}
      />
    </template>
  };

  static atom = class Atom extends Component<typeof PhoneField> {
    <template>
      <EntityDisplay @underline={{false}}>
        <:title>
          {{#if @model.countryCode}}
            +{{@model.countryCode}}{{@model.number}}
          {{else}}
            {{@model.number}}
          {{/if}}
        </:title>
        <:thumbnail>
          <PhoneIcon class='icon' />
        </:thumbnail>
      </EntityDisplay>
      <style scoped>
        .icon {
          color: var(--boxel-400);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof PhoneField> {
    <template>
      {{#if @model.countryCode}}
        <span>+{{@model.countryCode}}{{@model.number}}</span>
      {{else}}
        <span>{{@model.number}}</span>
      {{/if}}
    </template>
  };
}

export class ContactPhoneNumber extends FieldDef {
  @field phoneNumber = contains(PhoneField);
  @field type = contains(PhoneNumberType);

  static atom = class Atom extends Component<typeof ContactPhoneNumber> {
    <template>
      <EntityDisplay @underline={{false}}>
        <:title>
          {{#if @model.phoneNumber.countryCode}}
            +{{@model.phoneNumber.countryCode}}{{@model.phoneNumber.number}}
          {{else}}
            {{@model.phoneNumber.number}}
          {{/if}}
        </:title>
        <:thumbnail>
          <PhoneIcon class='icon' />
        </:thumbnail>
        <:tag>
          {{#if @model.type.label}}
            <Pill class='pill-gray'>
              {{@model.type.label}}
            </Pill>
          {{/if}}
        </:tag>
      </EntityDisplay>
      <style scoped>
        .icon {
          color: var(--boxel-400);
        }
        .pill-gray {
          --default-pill-padding: 0 var(--boxel-sp-xxxs);
          background-color: var(--boxel-200);
          border-color: transparent;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<
    typeof ContactPhoneNumber
  > {
    <template>
      <@fields.phoneNumber @format='embedded' />
    </template>
  };
}
