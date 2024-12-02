import {
  contains,
  field,
  Component,
  FieldDef,
  StringField,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import { LooseGooseyField, LooseyGooseyData } from './loosey-goosey';
import { PhoneInput } from '@cardstack/boxel-ui/components';
import Phone from '@cardstack/boxel-icons/phone';
import { RadioInput } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { action } from '@ember/object';

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

export class PhoneNumber extends StringField {
  static displayName = 'Phone Number';

  static edit = class Edit extends Component<typeof PhoneNumber> {
    <template>
      <PhoneInput @value={{@model}} @onInput={{@set}} />
    </template>
  };

  static atom = class Atom extends Component<typeof PhoneNumber> {
    <template>
      <div>
        <Phone />
        {{@model}}
      </div>
    </template>
  };
}

export class ContactPhoneNumber extends FieldDef {
  @field value = contains(PhoneNumber);
  @field type = contains(PhoneNumberType);

  static atom = class Atom extends Component<typeof ContactPhoneNumber> {
    <template>
      <@fields.value /> {{@model.type.label}}
    </template>
  };
}

//TODO: Remove this after implementing the phone number
export class CardWithContactPhoneNumber extends CardDef {
  @field contactPhone = contains(ContactPhoneNumber);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <@fields.contactPhone @format='atom' />
    </template>
  };
}
