import {
  Component,
  FieldDef,
  StringField,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';

import {
  BoxelSelect,
  Pill,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

import type IconComponent from '@cardstack/boxel-icons/captions';
import FacebookIcon from '@cardstack/boxel-icons/brand-facebook';
import LinkedinIcon from '@cardstack/boxel-icons/brand-linkedin';
import XIcon from '@cardstack/boxel-icons/brand-x';
import Link from '@cardstack/boxel-icons/link';

import { UrlField } from '../url';

export interface SocialMediaLink {
  label: string;
  icon: typeof IconComponent;
  cta: string;
  rootUrl?: string;
}

export const defaultSocialMedia: SocialMediaLink[] = [
  {
    label: 'X',
    icon: XIcon,
    cta: 'Follow',
    rootUrl: 'https://x.com/',
  },
  {
    label: 'LinkedIn',
    icon: LinkedinIcon,
    cta: 'Connect',
    rootUrl: 'https://www.linkedin.com/',
  },
  {
    label: 'Facebook',
    icon: FacebookIcon,
    cta: 'Follow',
    rootUrl: 'https://www.facebook.com/',
  },
  {
    label: 'Other',
    icon: Link,
    cta: 'Connect',
  },
];

export class SocialMediaLinkField extends FieldDef {
  static displayName = 'Social Media Link';
  static values: SocialMediaLink[] = defaultSocialMedia;
  @field label = contains(StringField);
  @field username = contains(StringField);
  @field displayLink = contains(UrlField, {
    computeVia: function (this: SocialMediaLinkField) {
      if (!this.value?.rootUrl) {
        return;
      }
      return this.username
        ? `${this.value.rootUrl}${this.username}`
        : this.value.rootUrl;
    },
  });
  @field url = contains(UrlField);
  @field fullUrl = contains(UrlField, {
    computeVia: function (this: SocialMediaLinkField) {
      if (this.url) {
        return this.url;
      }
      if (!this.value?.rootUrl || !this.username) {
        return;
      }
      return `${this.value.rootUrl}${this.username}`;
    },
  });

  get currentValues() {
    if (this.constructor && 'values' in this.constructor) {
      return this.constructor.values as SocialMediaLink[];
    }
    return SocialMediaLinkField.values;
  }
  get value() {
    return this.currentValues?.find((val) => val.label === this.label);
  }

  static edit = class Edit extends Component<typeof SocialMediaLinkField> {
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

      {{#if @model.value.rootUrl}}
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

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.fullUrl}}
        <Pill @tag='a' href={{@model.fullUrl}} target='_blank'>
          <span class='boxel-sr-only'><@fields.label /></span>
          <@model.value.icon height='20' width='20' />
        </Pill>
      {{/if}}
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if @model.fullUrl}}
        <Pill
          class='social-media-links'
          @tag='a'
          href={{@model.fullUrl}}
          target='_blank'
        >
          <:iconLeft>
            <@model.value.icon height='20' width='20' />
          </:iconLeft>
          <:default>
            {{@model.value.cta}}
          </:default>
        </Pill>
      {{/if}}
      <style scoped>
        .social-media-links {
          --pill-gap: var(--boxel-sp-xxxs);
        }
      </style>
    </template>
  };
}
