import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

import { contains, field, Component, FieldDef, StringField } from './card-api';
import NumberField from './number';

import {
  BoxelPhoneInput,
  EntityDisplayWithIcon,
  Pill,
  RadioInput,
} from '@cardstack/boxel-ui/components';
import {
  not,
  type NormalizePhoneFormatResult,
} from '@cardstack/boxel-ui/helpers';

import PhoneIcon from '@cardstack/boxel-icons/phone';

import { parsePhoneNumber } from 'awesome-phonenumber';

class Edit extends Component<typeof PhoneNumberField> {
  <template>
    <BoxelPhoneInput
      @value={{@model}}
      @onChange={{this.handleChange}}
      @disabled={{not @canEdit}}
    />
  </template>

  @action private handleChange(
    value: string | null,
    validation: NormalizePhoneFormatResult | null,
  ) {
    if ((validation === null || validation?.ok) && this.args.model !== value) {
      this.args.set(value);
    }
  }
}

export default class PhoneNumberField extends StringField {
  static displayName = 'Phone Number';
  static icon = PhoneIcon;

  static edit = Edit;

  static atom = class Atom extends Component<typeof PhoneNumberField> {
    <template>
      {{#if this.parsed.number}}
        <EntityDisplayWithIcon>
          <:title>
            <a href={{this.parsed.number.rfc3966}}>
              {{this.parsed.number.international}}
            </a>
          </:title>
          <:icon>
            <PhoneIcon class='icon' />
          </:icon>
        </EntityDisplayWithIcon>
      {{else}}
        <em>None</em>
      {{/if}}
      <style scoped>
        .icon {
          color: var(--muted-foreground, var(--boxel-400));
        }
        a:hover {
          text-decoration: underline;
          color: inherit;
        }
      </style>
    </template>

    get parsed() {
      let value = this.args.model?.trim();
      if (!value?.length || !parsePhoneNumber) {
        return;
      }
      let parsed = parsePhoneNumber(value);
      return parsed;
    }
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if this.parsed}}
        {{this.parsed}}
      {{else}}
        <em>None</em>
      {{/if}}
    </template>

    get parsed() {
      let value = this.args.model?.trim();
      if (!value?.length || !parsePhoneNumber) {
        return;
      }
      let parsed = parsePhoneNumber(value);
      return parsed?.number?.international;
    }
  };
}

class PhoneNumberTypeEdit extends Component<typeof PhoneNumberType> {
  @tracked label: string | undefined = this.args.model.label;

  statuses = PhoneNumberType.values;
  selectedStatus = this.selected;
  placeholder = 'Select phone number type';

  @action onSelectStatus(type: PhoneNumberType): void {
    this.onSelect(type);
  }

  get types() {
    return PhoneNumberType.values;
  }

  get selected() {
    return this.types?.find((type) => {
      return type.label === this.label;
    });
  }

  @action onSelect(type: PhoneNumberType): void {
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

export class PhoneNumberType extends FieldDef {
  static displayName = 'Phone Number Type';
  static values = [
    { index: 0, label: 'Mobile' },
    { index: 1, label: 'Home' },
    { index: 2, label: 'Work' },
  ];
  @field index = contains(NumberField);
  @field label = contains(StringField);
  static edit = PhoneNumberTypeEdit;
}

export class ContactPhoneNumber extends FieldDef {
  @field phoneNumber = contains(PhoneNumberField);
  @field type = contains(PhoneNumberType);

  static atom = class Atom extends Component<typeof ContactPhoneNumber> {
    <template>
      {{#if @model.phoneNumber}}
        <EntityDisplayWithIcon @underline={{false}}>
          <:title>
            <@fields.phoneNumber />
          </:title>
          <:tag>
            {{#if @model.type}}
              <Pill class='pill-gray'>
                <@fields.type.label />
              </Pill>
            {{/if}}
          </:tag>
        </EntityDisplayWithIcon>
      {{/if}}
      <style scoped>
        .pill-gray {
          --default-pill-padding: 0 var(--boxel-sp-xxxs);
          font-weight: 300;
          font-size: var(--boxel-font-size-xs);
          background-color: var(--muted, var(--boxel-200));
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
