import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

import {
  Component,
  CardDef,
  FieldDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { IconButton, RadioInput, Pill } from '@cardstack/boxel-ui/components';
import MailIcon from '@cardstack/boxel-icons/mail';
import PhoneIcon from '@cardstack/boxel-icons/phone';
import BrandTwitterIcon from '@cardstack/boxel-icons/brand-twitter';
import BrandLinkedinIcon from '@cardstack/boxel-icons/brand-linkedin';
import BuildingIcon from '@cardstack/boxel-icons/building';
import HeartHandshakeIcon from '@cardstack/boxel-icons/heart-handshake';
import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';
import UserCircleIcon from '@cardstack/boxel-icons/user-circle';

// helper functions that can share across different formats
const getStatusIcon = (label: string | undefined) => {
  switch (label) {
    case 'Customer':
      return {
        icon: HeartHandshakeIcon,
        lightColor: '#8bff98',
        darkColor: '#01d818',
      };
    case 'Lead':
      return {
        icon: TargetArrowIcon,
        lightColor: '#80d3ff',
        darkColor: '#02a7ff',
      };
    default:
      return null;
  }
};

interface PhoneFieldSignature {
  country: number;
  area: number;
  phoneNumber: number;
}

const formatPhone = (phone: PhoneFieldSignature | undefined) => {
  if (!phone) return undefined;

  if (!phone.country || !phone.area || !phone.phoneNumber) {
    return undefined;
  }

  return `+${phone.country} (${phone.area}) ${phone.phoneNumber}`;
};

const formatEmail = (email: string) => {
  if (!email) return undefined;
  return email;
};

const setBackgroundImage = (backgroundURL: string | null | undefined) => {
  if (!backgroundURL) {
    return;
  }
  return htmlSafe(`background-image: url(${backgroundURL});`);
};

class ViewCompanyCardTemplate extends Component<typeof CompanyCard> {
  <template>
    {{#if @model.name}}
      <div class='row'>
        <BuildingIcon class='icon' />
        <span class='building-name'>{{@model.name}}</span>
      </div>
    {{else}}
      <div class='row'>
        <BuildingIcon class='icon' />
        <span class='no-building'>No Company Assigned</span>
      </div>
    {{/if}}

    <style scoped>
      .icon {
        width: var(--boxel-icon-xs);
        height: var(--boxel-icon-xs);
        flex-shrink: 0;
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .row > span {
        -webkit-line-clamp: 1;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .building-name {
        font-size: var(--boxel-font-xs);
        font-weight: 300;
        text-decoration: underline;
      }
      .no-buidling {
        font-size: var(--boxel-font-xs);
        font-weight: 300;
      }
    </style>
  </template>
}

export class CompanyCard extends CardDef {
  static displayName = 'Company';
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: CompanyCard) {
      return this.name;
    },
  });

  static embedded = ViewCompanyCardTemplate;
  static atom = ViewCompanyCardTemplate;
}

class ViewSocialLinksTemplate extends Component<typeof SocialLinksField> {
  @action openSocialLink(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  <template>
    <div class='social-links'>
      {{#if @model.twitterURL}}
        <IconButton
          {{on 'click' (fn this.openSocialLink @model.twitterURL)}}
          @icon={{BrandTwitterIcon}}
          @width='20'
          @height='20'
          class='social-link'
        />
      {{/if}}
      {{#if @model.linkedInURL}}
        <IconButton
          {{on 'click' (fn this.openSocialLink @model.linkedInURL)}}
          @icon={{BrandLinkedinIcon}}
          @width='20'
          @height='20'
          class='social-link'
        />
      {{/if}}
    </div>

    <style scoped>
      .social-links {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }
      .social-link {
        --boxel-icon-button-width: var(--boxel-icon-lg);
        --boxel-icon-button-height: var(--boxel-icon-lg);
        border: 1px solid var(--boxel-300);
        border-radius: 5px;
      }
      .social-link:hover {
        border-color: var(--boxel-500);
        background-color: var(--boxel-100);
        cursor: pointer;
      }
    </style>
  </template>
}

export class SocialLinksField extends FieldDef {
  static displayName = 'socialLinks';
  @field twitterURL = contains(StringField);
  @field linkedInURL = contains(StringField);

  static embedded = ViewSocialLinksTemplate;
  static atom = ViewSocialLinksTemplate;
}

export interface LooseyGooseyData {
  index: number;
  label: string;
}

export class LooseGooseyField extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  static values: LooseyGooseyData[] = []; //help with the types
}

class EditContactStatusTemplate extends Component<typeof ContactStatusField> {
  @tracked label = this.args.model.label;

  get statuses() {
    return ContactStatusField.values;
  }

  get selectedStatus() {
    return this.statuses?.find((status) => {
      return status.label === this.label;
    });
  }

  @action handleStatusChange(status: LooseyGooseyData): void {
    this.label = status.label;
    this.args.model.label = this.selectedStatus?.label;
    this.args.model.index = this.selectedStatus?.index;
  }

  <template>
    <RadioInput
      @groupDescription='Select Status'
      @items={{this.statuses}}
      @checkedId={{this.selectedStatus.label}}
      @orientation='horizontal'
      @spacing='default'
      @keyName='label'
      as |item|
    >
      <item.component @onChange={{fn this.handleStatusChange item.data}}>
        {{item.data.label}}
      </item.component>
    </RadioInput>
  </template>
}

export class ContactStatusField extends LooseGooseyField {
  // loosey goosey pattern
  static displayName = 'status';

  static values = [
    {
      index: 0,
      label: 'Customer',
    },
    {
      index: 1,
      label: 'Lead',
    },
  ];

  static edit = EditContactStatusTemplate;
  static embedded = class Embedded extends Component<
    typeof ContactStatusField
  > {
    <template>
      {{@model.label}}
    </template>
  };
}

export class PhoneField extends FieldDef {
  static displayName = 'phoneMobile';
  @field country = contains(NumberField);
  @field area = contains(NumberField);
  @field phoneNumber = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      (+<@fields.country />) <@fields.area />-<@fields.phoneNumber />
    </template>
  };
}

class EmbeddedTemplate extends Component<typeof Contact> {
  <template>
    <article class='embedded-contact-card'>
      <div class='avatar-container'>
        <div
          class='avatar-thumbnail'
          {{! template-lint-disable no-inline-styles }}
          style={{setBackgroundImage @model.thumbnailURL}}
        >
          {{#unless @model.thumbnailURL}}
            <UserCircleIcon width='20' height='20' class='user-icon' />
          {{/unless}}
        </div>
        <div class='avatar-info'>
          <h3 class='name'>
            {{if @model.name @model.name 'No Name Assigned'}}
          </h3>
          <@fields.company
            @format='atom'
            @displayContainer={{false}}
            class='company-container'
          />
        </div>
      </div>

      <div class='contact-info'>
        {{#if @model.primaryEmail}}
          <div class='row primary-email'>
            <MailIcon class='icon gray' />
            <span>{{formatEmail @model.primaryEmail}}</span>
          </div>
        {{/if}}

        {{#if @model.secondaryEmail}}
          <div class='row secondary-email'>
            <MailIcon class='icon gray' />
            <span>{{formatEmail @model.secondaryEmail}}</span>
          </div>
        {{/if}}

        {{#if (formatPhone @model.phoneMobile)}}
          <div class='row primary-phone'>
            <PhoneIcon class='icon gray' />
            <span>{{formatPhone @model.phoneMobile}}</span>
            <Pill class='pill-gray'>
              mobile
            </Pill>
          </div>
        {{/if}}

        {{#if (formatPhone @model.phoneOffice)}}
          <div class='row secondary-phone'>
            <PhoneIcon class='icon gray' />
            <span>{{formatPhone @model.phoneOffice}}</span>
            <Pill class='pill-gray'>
              office
            </Pill>
          </div>
        {{/if}}
      </div>

      <@fields.socialLinks
        @format='atom'
        @displayContainer={{false}}
        class='social-links-container'
      />

      {{#if @model.status.label}}
        {{#let (getStatusIcon @model.status.label) as |statusIcon|}}
          <Pill
            class='status-pill'
            data-test-selected-type={{@model.status.label}}
            {{! template-lint-disable no-inline-styles }}
            style={{htmlSafe
              (concat 'background-color: ' statusIcon.lightColor ';')
            }}
          >
            <:iconLeft>
              <IconButton
                @icon={{statusIcon.icon}}
                class='status-icon'
                {{! template-lint-disable no-inline-styles }}
                style={{htmlSafe
                  (concat 'background-color: ' statusIcon.darkColor ';')
                }}
              />
            </:iconLeft>
            <:default>
              <span class='status-label-text'>
                {{@model.status.label}}
              </span>
            </:default>
          </Pill>
        {{/let}}
      {{/if}}
    </article>

    <style scoped>
      .embedded-contact-card {
        width: 100%;
        height: 100%;
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        background: var(--boxel-light);
      }
      .avatar-container {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        min-width: 0;
      }
      .avatar-thumbnail {
        background-color: var(--boxel-200);
        width: 60px;
        height: 60px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background-size: cover;
        background-position: center;
        border-radius: 50%;
      }
      .avatar-thumbnail .user-icon {
        color: var(--boxel-500);
        width: auto;
        height: auto;
      }
      .avatar-info {
        min-width: 0;
        width: 100%;
        overflow: hidden;
      }
      .name {
        -webkit-line-clamp: 1;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
        margin: 0;
        font-size: var(--boxel-font-size-med);
        font-weight: 600;
        letter-spacing: var(--boxel-lsp-sm);
      }
      .company-container {
        background: transparent;
        width: auto;
        height: auto;
        overflow: unset;
      }
      .contact-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-sm);
        color: var(--boxel-dark);
        margin-top: var(--boxel-sp);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        word-break: break-all;
        gap: var(--boxel-sp-xxs);
      }
      .icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        flex-shrink: 0;
      }
      .icon.gray {
        color: var(--boxel-300);
      }
      .pill-gray {
        font-weight: 500;
        font-size: var(--boxel-font-size-sm);
        word-break: keep-all;
        --pill-background-color: var(--boxel-200);
        border: none;
      }
      .social-links-container {
        display: flex;
        margin-top: var(--boxel-sp);
      }
      .status-pill {
        border-color: transparent;
        padding: 0;
        flex: none;
        overflow: hidden;
        align-self: flex-start;
        margin-top: auto;
      }
      .status-icon {
        --boxel-icon-button-width: var(--boxel-icon-med);
        --boxel-icon-button-height: var(--boxel-icon-med);
        border-radius: 0;
      }
      .status-label-text {
        font-size: var(--boxel-font-xs);
        font-weight: 600;
        padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-xxs);
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof Contact> {
  <template>
    <article class='fitted-contact-card'>
      <div class='avatar-container'>
        <div
          class='avatar-thumbnail'
          {{! template-lint-disable no-inline-styles }}
          style={{setBackgroundImage @model.thumbnailURL}}
        >
          {{#unless @model.thumbnailURL}}
            <UserCircleIcon width='20' height='20' class='user-icon' />
          {{/unless}}
        </div>
        <div class='avatar-info'>
          <h3 class='name'>
            {{if @model.name @model.name 'No Name Assigned'}}
          </h3>
          <@fields.company
            @format='atom'
            @displayContainer={{false}}
            class='company-container'
          />
        </div>
      </div>

      <div class='contact-info'>
        {{#if @model.primaryEmail}}
          <div class='row primary-email'>
            <MailIcon class='icon gray' />
            <span>{{formatEmail @model.primaryEmail}}</span>
          </div>
        {{/if}}

        {{#if @model.secondaryEmail}}
          <div class='row secondary-email'>
            <MailIcon class='icon gray' />
            <span>{{formatEmail @model.secondaryEmail}}</span>
          </div>
        {{/if}}

        {{#if (formatPhone @model.phoneMobile)}}
          <div class='row primary-phone'>
            <PhoneIcon class='icon gray' />
            <span>{{formatPhone @model.phoneMobile}}</span>
            <Pill class='pill-gray'>
              mobile
            </Pill>
          </div>
        {{/if}}

        {{#if (formatPhone @model.phoneOffice)}}
          <div class='row secondary-phone'>
            <PhoneIcon class='icon gray' />
            <span>{{formatPhone @model.phoneOffice}}</span>
            <Pill class='pill-gray'>
              office
            </Pill>
          </div>
        {{/if}}
      </div>

      <@fields.socialLinks
        @format='atom'
        @displayContainer={{false}}
        class='social-links-container'
      />

      {{#if @model.status.label}}
        {{#let (getStatusIcon @model.status.label) as |statusIcon|}}
          <Pill
            class='status-pill'
            data-test-selected-type={{@model.status.label}}
            {{! template-lint-disable no-inline-styles }}
            style={{htmlSafe
              (concat 'background-color: ' statusIcon.lightColor ';')
            }}
          >
            <:iconLeft>
              <IconButton
                @icon={{statusIcon.icon}}
                class='status-icon'
                {{! template-lint-disable no-inline-styles }}
                style={{htmlSafe
                  (concat 'background-color: ' statusIcon.darkColor ';')
                }}
              />
            </:iconLeft>
            <:default>
              <span class='status-label-text'>
                {{@model.status.label}}
              </span>
            </:default>
          </Pill>
        {{/let}}
      {{/if}}
    </article>

    <style scoped>
      .fitted-contact-card {
        width: 100%;
        height: 100%;
        padding: var(--boxel-sp-lg);
        display: flex;
        background: var(--boxel-light);
      }
      .avatar-container {
        display: flex;
        align-items: normal;
        gap: var(--boxel-sp);
        min-width: 0;
      }
      .avatar-thumbnail {
        background-color: var(--boxel-200);
        width: 60px;
        height: 60px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background-size: cover;
        background-position: center;
        border-radius: 50%;
      }
      .avatar-thumbnail .user-icon {
        color: var(--boxel-500);
        width: auto;
        height: auto;
      }
      .avatar-info {
        min-width: 0;
        width: 100%;
        overflow: hidden;
      }
      .name {
        -webkit-line-clamp: 1;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
        margin: 0;
        font-size: var(--boxel-font-size-med);
        font-weight: 600;
        letter-spacing: var(--boxel-lsp-sm);
      }
      .company-container {
        background: transparent;
        width: auto;
        height: auto;
        overflow: unset;
      }
      .contact-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-sm);
        color: var(--boxel-dark);
        margin-top: var(--boxel-sp);
      }
      .icon {
        width: var(--boxel-icon-xs);
        height: var(--boxel-icon-xs);
        flex-shrink: 0;
      }
      .icon.gray {
        color: var(--boxel-300);
      }
      .pill-gray {
        font-weight: 500;
        font-size: var(--boxel-font-size-sm);
        word-break: keep-all;
        --pill-background-color: var(--boxel-200);
        border: none;
      }
      .status-pill {
        border-color: transparent;
        padding: 0;
        flex: none;
        overflow: hidden;
        margin-top: auto;
      }
      .status-icon {
        --boxel-icon-button-width: var(--boxel-icon-med);
        --boxel-icon-button-height: var(--boxel-icon-med);
      }
      .status-label-text {
        display: block;
        font-size: var(--boxel-font-size-sm);
        padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-xxs);
        font-weight: 600;
      }
      .row {
        display: flex;
        align-items: center;
        word-break: break-all;
        gap: var(--boxel-sp-xxs);
      }

      /* Square layout (aspect-ratio = 1.0) or portrait layout with height < 226px */
      @container fitted-card ((aspect-ratio = 1.0) or ((aspect-ratio < 1.0) and (height <= 226px))) {
        .fitted-contact-card {
          flex-direction: column;
          padding: var(--boxel-sp-sm);
        }
        .avatar-container {
          flex-direction: column;
        }

        .avatar-thumbnail {
          width: 50px;
          height: 50px;
          margin: 0 auto;
        }

        .avatar-info {
          text-align: center;
        }

        .name {
          font-size: var(--boxel-font-size);
        }

        .avatar-info :global(.row) {
          justify-content: center;
        }

        .contact-info,
        .social-links-container,
        .status-pill,
        .primary-email,
        .secondary-email,
        .secondary-phone,
        .pill-gray {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (226px <= height) {
        .fitted-contact-card {
          flex-direction: column;
          padding: var(--boxel-sp-sm);
        }

        .avatar-container {
          flex-direction: column;
        }

        .avatar-info {
          text-align: center;
        }

        .avatar-info :global(.row) {
          justify-content: center;
        }

        .avatar-thumbnail {
          width: 50px;
          height: 50px;
          margin: 0 auto;
        }

        .status-pill {
          align-self: flex-end;
        }

        .social-links-container,
        .secondary-email,
        .secondary-phone,
        .pill-gray {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (58px <= height < 180px)) {
        .fitted-contact-card {
          align-content: center;
        }

        .social-links-container,
        .primary-email,
        .secondary-email,
        .secondary-phone,
        .pill-gray {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (500px <= width) and (58px <= height <= 77px)) {
        .fitted-contact-card {
          align-content: center;
          padding: var(--boxel-sp-xxs);
        }

        .social-links-container,
        .primary-email,
        .secondary-email,
        .secondary-phone,
        .pill-gray {
          display: none;
        }
      }

      /* Horizontal layouts (aspect-ratio > 1.0) */
      @container fitted-card ((1.0 < aspect-ratio) and (115px <= height)) {
        .fitted-contact-card {
          flex-direction: column;
          padding: var(--boxel-sp-sm);
        }

        .social-links-container,
        .primary-email,
        .secondary-email,
        .secondary-phone {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (115px <= height < 180px)) {
        .social-links-container,
        .status-pill {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (180px <= height)) {
        .status-pill {
          align-self: flex-end;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (58px <= height < 115px)) {
        .fitted-contact-card {
          padding: var(--boxel-sp-sm);
        }

        .avatar-container {
          display: flex;
          gap: var(--boxel-sp-xxs);
          flex: 1;
        }

        .avatar-thumbnail {
          width: 35px;
          height: 35px;
        }

        .name {
          font-size: var(--boxel-font-size-sm);
        }

        .contact-info,
        .social-links-container,
        .status-pill {
          display: none;
        }
      }

      /* Smallest horizontal layout */
      @container fitted-card ((1.0 < aspect-ratio) and (50px <= height < 58px)) {
        .fitted-contact-card {
          align-content: center;
          padding: var(--boxel-sp-xxxs);
        }

        .avatar-thumbnail {
          width: 32px;
          height: 32px;
        }

        .contact-info,
        .social-links-container,
        .status-pill,
        .company-container {
          display: none;
        }
      }

      /* Fallback for extremely small sizes */
      @container fitted-card ((1.0 < aspect-ratio) and (height < 50px)) {
        .fitted-contact-card {
          display: flex;
          align-content: center;
          padding: var(--boxel-sp-xxxs);
        }

        .name {
          font-size: var(--boxel-font-xs);
        }

        .avatar-thumbnail,
        .contact-info,
        .social-links-container,
        .status-pill,
        .company-container {
          display: none;
        }
      }
    </style>
  </template>
}

export class Contact extends CardDef {
  static displayName = 'CRM Contact';
  @field name = contains(StringField);
  @field primaryEmail = contains(StringField);
  @field secondaryEmail = contains(StringField);
  @field phoneMobile = contains(PhoneField);
  @field phoneOffice = contains(PhoneField);
  @field socialLinks = contains(SocialLinksField);
  @field company = linksTo(CompanyCard);
  @field status = contains(ContactStatusField);

  @field title = contains(StringField, {
    computeVia: function (this: Contact) {
      return this.name;
    },
  });

  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}
