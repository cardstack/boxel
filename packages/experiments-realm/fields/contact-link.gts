import {
  Component,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';

import { BoxelSelect, FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import Email from '@cardstack/boxel-icons/mail';
import Phone from '@cardstack/boxel-icons/phone';

import {
  SocialMediaLinkField,
  defaultSocialMedia,
  type SocialMediaLink,
} from './social-media-link';

import { EmailField } from '../email';
import { UrlField } from '../url';

const contactValues: SocialMediaLink[] = [
  ...defaultSocialMedia,
  {
    label: 'Email',
    icon: Email,
    cta: 'Contact',
  },
  {
    label: 'Phone',
    icon: Phone,
    cta: 'Call',
  },
];

export class ContactLinkField extends SocialMediaLinkField {
  static displayName = 'Contact Link';
  static values: SocialMediaLink[] = contactValues;
  @field email = contains(EmailField);
  @field phone = contains(StringField);
  @field fullUrl = contains(UrlField, {
    computeVia: function (this: ContactLinkField) {
      if (this.email) {
        return `mailto:${this.email}`;
      } else if (this.phone) {
        return `tel:${this.phone}`;
      } else if (this.url) {
        return this.url;
      } else if (!this.value?.rootUrl || !this.username) {
        return;
      }
      return `${this.value.rootUrl}${this.username}`;
    },
  });
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
      {{#if (eq @model.value.label 'Email')}}
        <FieldContainer @vertical={{true}} @label='Address' @tag='label'>
          <@fields.email />
        </FieldContainer>
      {{else if (eq @model.value.label 'Phone')}}
        <FieldContainer @vertical={{true}} @label='Number' @tag='label'>
          <@fields.phone />
        </FieldContainer>
      {{else if @model.value.rootUrl}}
        <FieldContainer @vertical={{true}} @label='Username' @tag='label'>
          <@fields.username />
        </FieldContainer>
        <FieldContainer @vertical={{true}} @label='Url'>
          <@fields.displayLink />
        </FieldContainer>
      {{else}}
        <FieldContainer @vertical={{true}} @label='Url' @tag='label'>
          <@fields.url />
        </FieldContainer>
      {{/if}}
    </template>

    options = this.args.model.currentValues;

    get selectedOption() {
      return this.options?.find(
        (option) => option.label === this.args.model.label,
      );
    }

    onSelect = (option: SocialMediaLink) =>
      (this.args.model.label = option.label);
  };
}
