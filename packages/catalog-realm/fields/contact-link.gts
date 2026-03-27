import {
  Component,
  field,
  contains,
  StringField,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import UrlField from 'https://cardstack.com/base/url';

import {
  BoxelSelect,
  FieldContainer,
  Pill,
} from '@cardstack/boxel-ui/components';

import type IconComponent from '@cardstack/boxel-icons/captions';
import Email from '@cardstack/boxel-icons/mail';
import Link from '@cardstack/boxel-icons/link';
import Phone from '@cardstack/boxel-icons/phone';

export interface ContactLink {
  type: 'email' | 'tel' | 'link' | string;
  label: string;
  icon: typeof IconComponent;
  cta: string;
}

const contactValues: ContactLink[] = [
  {
    type: 'email',
    label: 'Email',
    icon: Email,
    cta: 'Email',
  },
  {
    type: 'tel',
    label: 'Phone',
    icon: Phone,
    cta: 'Contact',
  },
  {
    type: 'link',
    label: 'Other',
    icon: Link,
    cta: 'Connect',
  },
];

export default class ContactLinkField extends FieldDef {
  static displayName = 'Contact Link';
  static values: ContactLink[] = contactValues;
  @field label = contains(StringField);
  @field value = contains(StringField);
  @field url = contains(UrlField, {
    computeVia: function (this: ContactLinkField) {
      switch (this.item?.type) {
        case 'email':
          return `mailto:${this.value}`;
        case 'tel':
          return `tel:${this.value}`;
        default:
          return this.value;
      }
    },
  });
  get items() {
    if (this.constructor && 'values' in this.constructor) {
      return this.constructor.values as ContactLink[];
    }
    return ContactLinkField.values;
  }
  get item() {
    return this.items?.find((val) => val.label === this.label);
  }
  static edit = class Edit extends Component<typeof this> {
    <template>
      <FieldContainer @vertical={{true}} @label='Type' @tag='label'>
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
      <FieldContainer @vertical={{true}} @label={{this.label}} @tag='label'>
        <@fields.value />
      </FieldContainer>
      <style scoped>
        label + label {
          margin-top: var(--boxel-sp-xs);
        }
      </style>
    </template>

    options = this.args.model.items;

    onSelect = (option: ContactLink) => (this.args.model.label = option.label);

    get selectedOption() {
      return this.options?.find(
        (option) => option.label === this.args.model.label,
      );
    }

    get label() {
      switch (this.selectedOption?.type) {
        case 'email':
          return 'Address';
        case 'tel':
          return 'Number';
        default:
          return 'Link';
      }
    }
  };
  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.url}}
        <Pill
          @tag='a'
          href={{@model.url}}
          target='_blank'
          rel='noopener noreferrer'
        >
          <span class='boxel-sr-only'><@fields.label /></span>
          <@model.item.icon height='20' width='20' />
        </Pill>
      {{/if}}
      <style scoped>
        a:hover {
          border-color: var(--boxel-dark);
        }
        a:focus:focus-visible {
          outline-color: var(--boxel-highlight);
          outline-offset: -1px;
        }
      </style>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if @model.url}}
        <Pill
          @tag='a'
          href={{@model.url}}
          target='_blank'
          rel='noopener noreferrer'
        >
          <:iconLeft>
            <@model.item.icon height='20' width='20' />
          </:iconLeft>
          <:default>
            {{@model.item.cta}}
          </:default>
        </Pill>
      {{/if}}
      <style scoped>
        a {
          --pill-gap: var(--boxel-sp-xxxs);
        }
        a:hover {
          border-color: var(--boxel-dark);
        }
        a:focus:focus-visible {
          outline-color: var(--boxel-highlight);
          outline-offset: -1px;
        }
      </style>
    </template>
  };
}
