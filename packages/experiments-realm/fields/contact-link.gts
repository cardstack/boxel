import {
  Component,
  field,
  contains,
  StringField,
  FieldDef,
} from 'https://cardstack.com/base/card-api';

import {
  BoxelSelect,
  FieldContainer,
  Pill,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import type IconComponent from '@cardstack/boxel-icons/captions';
import Email from '@cardstack/boxel-icons/mail';
import Link from '@cardstack/boxel-icons/link';
import Phone from '@cardstack/boxel-icons/phone';

import { EmailField } from '../email';
import { UrlField } from '../url';

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

export class ContactLinkField extends FieldDef {
  static displayName = 'Contact Link';
  static values: ContactLink[] = contactValues;
  @field label = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(StringField);
  @field link = contains(UrlField);
  @field url = contains(UrlField, {
    computeVia: function (this: ContactLinkField) {
      switch (this.value?.type) {
        case 'email':
          return `mailto:${this.email}`;
        case 'tel':
          return `tel:${this.phone}`;
        default:
          return this.link;
      }
    },
  });
  get currentValues() {
    if (this.constructor && 'values' in this.constructor) {
      return this.constructor.values as ContactLink[];
    }
    return ContactLinkField.values;
  }
  get value() {
    return this.currentValues?.find((val) => val.label === this.label);
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
      {{#if (eq @model.value.type 'email')}}
        <FieldContainer @vertical={{true}} @label='Address' @tag='label'>
          <@fields.email />
        </FieldContainer>
      {{else if (eq @model.value.type 'tel')}}
        <FieldContainer @vertical={{true}} @label='Number' @tag='label'>
          <@fields.phone />
        </FieldContainer>
      {{else}}
        <FieldContainer @vertical={{true}} @label='Link' @tag='label'>
          <@fields.link />
        </FieldContainer>
      {{/if}}
      <style scoped>
        label + label {
          margin-top: var(--boxel-sp-xs);
        }
      </style>
    </template>

    options = this.args.model.currentValues;

    get selectedOption() {
      return this.options?.find(
        (option) => option.label === this.args.model.label,
      );
    }

    onSelect = (option: ContactLink) => (this.args.model.label = option.label);
  };
  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.url}}
        <Pill @tag='a' href={{@model.url}} target='_blank'>
          <span class='boxel-sr-only'><@fields.label /></span>
          <@model.value.icon height='20' width='20' />
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
        <Pill @tag='a' href={{@model.url}} target='_blank'>
          <:iconLeft>
            <@model.value.icon height='20' width='20' />
          </:iconLeft>
          <:default>
            {{@model.value.cta}}
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
