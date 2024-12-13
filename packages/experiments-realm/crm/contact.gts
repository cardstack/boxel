import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { PhoneField } from '../phone';
import { EmailField } from '../email';
import { ContactLinkField } from '../fields/contact-link';
import {
  Component,
  CardDef,
  FieldDef,
  field,
  contains,
  linksTo,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { RadioInput } from '@cardstack/boxel-ui/components';
import HeartHandshakeIcon from '@cardstack/boxel-icons/heart-handshake';
import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';
import AvatarGroup from '../components/avatar-group';
import { Company } from './company';
import { Avatar } from '@cardstack/boxel-ui/components';
import { StatusPill } from '../components/status-pill';
import type IconComponent from '@cardstack/boxel-icons/captions';
import ContactIcon from '@cardstack/boxel-icons/contact';
import Email from '@cardstack/boxel-icons/mail';
import Linkedin from '@cardstack/boxel-icons/linkedin';
import XIcon from '@cardstack/boxel-icons/brand-x';

export class SocialLinkField extends ContactLinkField {
  static displayName = 'social-link';

  static values = [
    {
      type: 'social',
      label: 'X',
      icon: XIcon,
      cta: 'Follow',
    },
    {
      type: 'social',
      label: 'LinkedIn',
      icon: Linkedin,
      cta: 'Connect',
    },
    {
      type: 'email',
      label: 'Email',
      icon: Email,
      cta: 'Contact',
    },
  ];
}

const getStatusData = (
  label: string | undefined,
): LooseyGooseyData | undefined => {
  return StatusField.values.find((status) => status.label === label);
};

export interface LooseyGooseyData {
  index: number;
  label: string;
  icon: typeof IconComponent;
  lightColor: string;
  darkColor: string;
}

export class LooseGooseyField extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  static values: LooseyGooseyData[] = []; //help with the types
}

class EditContactStatusTemplate extends Component<typeof StatusField> {
  @tracked label = this.args.model.label;

  get statuses() {
    return StatusField.values;
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

export class StatusField extends LooseGooseyField {
  // loosey goosey pattern
  static displayName = 'status';

  static values = [
    {
      index: 0,
      label: 'Customer',
      icon: HeartHandshakeIcon,
      lightColor: '#8bff98',
      darkColor: '#01d818',
    },
    {
      index: 1,
      label: 'Lead',
      icon: TargetArrowIcon,
      lightColor: '#E6F4FF',
      darkColor: '#0090FF',
    },
  ];

  static edit = EditContactStatusTemplate;
  static embedded = class Embedded extends Component<typeof StatusField> {
    <template>
      {{@model.label}}
    </template>
  };
}

class EmbeddedTemplate extends Component<typeof Contact> {
  get hasSocialLinks() {
    return (
      this.args.model.socialLinks && this.args.model.socialLinks.length > 0
    );
  }

  <template>
    <article class='embedded-contact-card'>
      <AvatarGroup
        @userId={{@model.id}}
        @name={{@model.name}}
        @thumbnailURL={{@model.thumbnailURL}}
      >
        <:content>
          <@fields.company @format='atom' @displayContainer={{false}} />
        </:content>
      </AvatarGroup>

      <div class='contact-info'>
        <@fields.primaryEmail @format='atom' />
        <@fields.secondaryEmail @format='atom' />
        <@fields.phoneMobile @format='atom' />
        <@fields.phoneOffice @format='atom' />
      </div>

      {{#if this.hasSocialLinks}}
        <div class='links'>
          <@fields.socialLinks @format='atom' />
        </div>
      {{/if}}

      {{#if @model.status.label}}
        {{#let (getStatusData @model.status.label) as |statusData|}}
          <StatusPill
            @label={{@model.status.label}}
            @icon={{statusData.icon}}
            @iconDarkColor={{statusData.darkColor}}
            @iconLightColor={{statusData.lightColor}}
            class='crm-status-pill'
          />
        {{/let}}
      {{/if}}
    </article>

    <style scoped>
      .embedded-contact-card {
        width: 100%;
        height: 100%;
        padding: var(--boxel-sp);
        overflow: hidden;
        display: grid;
        gap: var(--boxel-sp-sm);
        grid-template-areas:
          'avatar-group-container'
          'contact-info'
          'links'
          'status';
        grid-template-rows: max-content max-content max-content auto;
      }
      .contact-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
        font-size: var(--boxel-font-sm);
        color: var(--boxel-dark);
      }
      .links :deep(div) {
        display: flex;
        gap: var(--boxel-sp-xxxs);
        flex-wrap: wrap;
      }
      .crm-status-pill {
        width: fit-content;
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof Contact> {
  get hasSocialLinks() {
    return (
      this.args.model.socialLinks && this.args.model.socialLinks.length > 0
    );
  }

  <template>
    <article class='fitted-contact-card'>
      <AvatarGroup
        @userId={{@model.id}}
        @name={{@model.name}}
        @thumbnailURL={{@model.thumbnailURL}}
        class='avatar-group-container'
      >
        <:content>
          <@fields.company @format='atom' @displayContainer={{false}} />
        </:content>
      </AvatarGroup>

      <div class='contact-info'>
        <div class='primary-email'>
          <@fields.primaryEmail @format='atom' />
        </div>
        <div class='secondary-email'>
          <@fields.secondaryEmail @format='atom' />
        </div>
        <div class='phone-mobile'>
          <@fields.phoneMobile @format='atom' />
        </div>
        <div class='phone-office'>
          <@fields.phoneOffice @format='atom' />
        </div>
      </div>

      {{#if this.hasSocialLinks}}
        <div class='links'>
          <@fields.socialLinks @format='atom' />
        </div>
      {{/if}}

      {{#if @model.status.label}}
        {{#let (getStatusData @model.status.label) as |statusData|}}
          <StatusPill
            @label={{@model.status.label}}
            @icon={{statusData.icon}}
            @iconDarkColor={{statusData.darkColor}}
            @iconLightColor={{statusData.lightColor}}
            class='crm-status-pill'
          />
        {{/let}}
      {{/if}}
    </article>

    <style scoped>
      .fitted-contact-card {
        --icon-size: 16px;
        width: 100%;
        height: 100%;
        min-width: 100px;
        min-height: 29px;
        overflow: hidden;
        display: grid;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        grid-template-areas:
          'avatar-group-container'
          'contact-info'
          'links'
          'status';
        grid-template-rows: max-content max-content max-content auto;
      }
      .avatar-group-container {
        grid-area: avatar-group-container;
      }
      .avatar-group-container
        :where(.avatar-info .company-group .entity-name-tag) {
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 1;
      }
      .contact-info {
        grid-area: contact-info;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
        font-size: var(--boxel-font-sm);
        color: var(--boxel-dark);
        word-break: break-word;
      }
      .links {
        grid-area: links;
      }
      .crm-status-pill {
        grid-area: status;
        width: fit-content;
      }
      .links {
        font-size: var(--boxel-font-xs);
        align-self: normal;
      }
      .links :deep(div) {
        display: flex;
        gap: var(--boxel-sp-xxxs);
        flex-wrap: wrap;
      }

      @container fitted-card ((aspect-ratio <= 1.0) and (224px <= height <= 226px)) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'links'
            'status';
          grid-template-rows: max-content max-content auto;
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 45px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size);
        }
        .contact-info {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (180px <= height < 224px) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'links'
            'status';
          grid-template-rows: max-content max-content auto;
          gap: var(--boxel-sp-xs);
        }
        .contact-info {
          display: none;
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 45px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size);
        }
      }

      @container fitted-card ((aspect-ratio <= 1.0) and (height < 180px) ) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'status';
          grid-template-rows: max-content auto;
          gap: var(--boxel-sp-xs);
        }
        .contact-info,
        .links {
          display: none;
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xxs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 30px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size-sm);
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (148px <= height < 180px) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'status';
          grid-template-rows: max-content auto;
          gap: var(--boxel-sp-xs);
        }
        .contact-info,
        .links {
          display: none;
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xxs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 30px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size-sm);
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (128px <= height < 148px) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'status';
          grid-template-rows: max-content auto;
          gap: var(--boxel-sp-xs);
        }
        .contact-info,
        .links {
          display: none;
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xxs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 30px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size-sm);
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (118px <= height < 128px) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'status';
          grid-template-rows: max-content auto;
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xxs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 30px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size-sm);
        }
      }

      @container fitted-card ((aspect-ratio <= 1.0) and (400px <= height) and (226px < width)) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'contact-info'
            'links'
            'status';
          grid-template-rows: max-content max-content max-content auto;
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 55px;
        }
      }

      @container fitted-card ((aspect-ratio <= 1.0) and (400px <= height)) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'contact-info'
            'links'
            'status';
          grid-template-rows: max-content max-content max-content auto;
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 55px;
        }
      }

      /* 1.0 < Aspect ratio (Horizontal card) */
      @container fitted-card ((1.0 < aspect-ratio) and (180px <= height)) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'links'
            'status';
          grid-template-rows: max-content max-content auto;
          gap: var(--boxel-sp-xs);
        }
        .contact-info {
          display: none;
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 50px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size);
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (151px <= height < 180px)) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'status';
          grid-template-rows: max-content auto;
          gap: var(--boxel-sp-xs);
        }
        .contact-info,
        .links {
          display: none;
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 40px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size);
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (115px <= height <= 150px)) {
        .fitted-contact-card {
          grid-template:
            'avatar-group-container'
            'status';
          grid-template-rows: max-content auto;
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xxs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 30px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size-sm);
        }
        .contact-info,
        .links {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (78px <= height <= 114px)) {
        .fitted-contact-card {
          grid-template: 'avatar-group-container';
          grid-template-rows: max-content;
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xxs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 30px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size-sm);
        }
        .contact-info,
        .links,
        .crm-status-pill {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (500px <= width) and (58px <= height <= 77px)) {
        .fitted-contact-card {
          grid-template: 'avatar-group-container status';
          grid-template-columns: max-content auto;
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xxs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 30px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size-sm);
        }
        .contact-info,
        .links {
          display: none;
        }
        .crm-status-pill {
          margin-left: auto;
          margin-top: 0;
          align-self: center;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (226px <= width <= 499px) and (58px <= height <= 77px)) {
        .fitted-contact-card {
          grid-template: 'avatar-group-container';
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xxs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 30px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size-sm);
        }
        .links,
        .crm-status-pill {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (width <= 225px) and (58px <= height <= 77px)) {
        .fitted-contact-card {
          grid-template: 'avatar-group-container';
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xxs);
        }
        .avatar-group-container :where(.avatar-thumbnail) {
          --profile-avatar-icon-size: 30px;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size-sm);
        }
        .links,
        .crm-status-pill {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (height <= 57px)) {
        .fitted-contact-card {
          grid-template: 'avatar-group-container';
          gap: var(--boxel-sp-xs);
        }
        .avatar-group-container {
          gap: var(--boxel-sp-xxs);
        }
        .avatar-group-container :where(.avatar-thumbnail),
        .avatar-group-container :where(.company-group),
        .links,
        .crm-status-pill {
          display: none;
        }
        .avatar-group-container :where(.avatar-info .name) {
          font-size: var(--boxel-font-size-sm);
        }
      }
    </style>
  </template>
}

class AtomTemplate extends Component<typeof Contact> {
  get label() {
    return this.args.model?.name && this.args.model?.position
      ? `${this.args.model?.name} • ${this.args.model?.position}`
      : this.args.model?.name ?? '';
  }
  <template>
    <div class='contact'>
      {{#if @model.id}}
        <Avatar
          @userID={{@model.id}}
          @displayName={{@model.name}}
          @thumbnailURL={{@model.thumbnailURL}}
          @isReady={{true}}
          class='avatar'
        />
      {{/if}}
      <span class='name'>{{@model.name}}</span>
    </div>
    <style scoped>
      .contact {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0; /* Helps with text overflow */
      }
      .avatar {
        --profile-avatar-icon-size: 30px;
        flex-shrink: 0;
      }
      .name {
        text-decoration: underline;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
}

export class Contact extends CardDef {
  static displayName = 'CRM Contact';
  static icon = ContactIcon;

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field position = contains(StringField);
  @field company = linksTo(Company);
  @field department = contains(StringField);
  @field primaryEmail = contains(EmailField);
  @field secondaryEmail = contains(EmailField);
  @field phoneMobile = contains(PhoneField);
  @field phoneOffice = contains(PhoneField);
  @field status = contains(StatusField);
  @field socialLinks = containsMany(SocialLinkField);

  @field name = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: Contact) {
      return this.name;
    },
  });

  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
  static atom = AtomTemplate;
}
