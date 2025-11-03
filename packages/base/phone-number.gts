import { contains, field, Component, FieldDef, StringField } from './card-api';
import { PhoneInput } from '@cardstack/boxel-ui/components';
import {
  RadioInput,
  EntityDisplayWithIcon,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import NumberField from './number';

import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { action } from '@ember/object';

import PhoneIcon from '@cardstack/boxel-icons/phone';

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

export default class PhoneNumberField extends StringField {
  static displayName = 'Phone Number';
  static icon = PhoneIcon;

  static edit = class Edit extends Component<typeof PhoneNumberField> {
    <template>
      <PhoneInput
        @value={{@model}}
        @onChange={{@set}}
        {{!-- @errorMessage={{this.textInputValidator.errorMessage}}
        @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}} --}}
        @disabled={{not @canEdit}}
      />
    </template>
  };

  static atom = class Atom extends Component<typeof PhoneNumberField> {
    <template>
      <EntityDisplayWithIcon @underline={{false}}>
        <:title>
          {{@model}}
        </:title>
        <:icon>
          <PhoneIcon class='icon' />
        </:icon>
      </EntityDisplayWithIcon>
      <style scoped>
        .icon {
          color: var(--muted, var(--boxel-400));
        }
      </style>
    </template>
  };
}

// export class ContactPhoneNumber extends FieldDef {
//   @field phoneNumber = contains(PhoneNumberField);
//   @field type = contains(PhoneNumberType);

//   static atom = class Atom extends Component<typeof ContactPhoneNumber> {
//     get hasPhoneNumber() {
//       return Boolean(this.args.model?.phoneNumber?.number);
//     }

//     get hasCountryCode() {
//       return Boolean(this.args.model?.phoneNumber?.countryCode);
//     }

//     get hasTypeLabel() {
//       return Boolean(this.args.model?.type?.label?.length);
//     }

//     get hasCountryCodeAndPhoneNumber() {
//       return (
//         this.args.model &&
//         this.hasCountryCode &&
//         this.hasPhoneNumber &&
//         this.hasTypeLabel
//       );
//     }

//     <template>
//       {{#if @model}}
//         <EntityDisplayWithIcon @underline={{false}}>
//           <:title>
//             {{@model}}
//           </:title>
//           <:icon>
//             <PhoneIcon class='icon' />
//           </:icon>
//           <:tag>
//             {{#if this.hasTypeLabel}}
//               <Pill class='pill-gray'>
//                 {{@model.type.label}}
//               </Pill>
//             {{/if}}
//           </:tag>
//         </EntityDisplayWithIcon>
//       {{/if}}
//       <style scoped>
//         .icon {
//           color: var(--boxel-400);
//         }
//         .pill-gray {
//           --default-pill-padding: 0 var(--boxel-sp-xxxs);
//           --default-pill-font: 300 var(--boxel-font-xs);
//           background-color: var(--boxel-200);
//           border-color: transparent;
//         }
//       </style>
//     </template>
//   };

//   static embedded = class Embedded extends Component<
//     typeof ContactPhoneNumber
//   > {
//     <template>
//       <@fields.phoneNumber @format='embedded' />
//     </template>
//   };
// }
