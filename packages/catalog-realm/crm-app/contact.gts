import StringField from 'https://cardstack.com/base/string';
import {
  Component,
  CardDef,
  field,
  contains,
  linksTo,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import { ContactPhoneNumber } from 'https://cardstack.com/base/phone-number';
import EmailField from 'https://cardstack.com/base/email';

import {
  Avatar,
  FieldContainer,
  EntityDisplayWithThumbnail,
} from '@cardstack/boxel-ui/components';
import AvatarGroup from './components/avatar-group';

import ContactIcon from '@cardstack/boxel-icons/contact';
import Email from '@cardstack/boxel-icons/mail';
import Linkedin from '@cardstack/boxel-icons/linkedin';
import XIcon from '@cardstack/boxel-icons/brand-x';

import { CrmApp } from './crm-app';
import { Company } from './company';
import { StatusTagField } from './contact-status-tag';

import { ContactLinkField } from '../fields/contact-link';

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

class EditTemplate extends Component<typeof Contact> {
  <template>
    <div class='contact-form'>
      <FieldContainer @label='First Name'>
        <@fields.firstName />
      </FieldContainer>
      <FieldContainer @label='Last Name'>
        <@fields.lastName />
      </FieldContainer>
      <FieldContainer @label='Position'>
        <@fields.position />
      </FieldContainer>
      <FieldContainer @label='Company'>
        <@fields.company />
      </FieldContainer>
      <FieldContainer @label='Department'>
        <@fields.department />
      </FieldContainer>
      <FieldContainer @label='Primary Email'>
        <@fields.primaryEmail />
      </FieldContainer>
      <FieldContainer @label='Secondary Email'>
        <@fields.secondaryEmail />
      </FieldContainer>
      <FieldContainer @label='Phone Number'>
        <@fields.phoneMobile />
      </FieldContainer>
      <FieldContainer @label='Office Phone Number'>
        <@fields.phoneOffice />
      </FieldContainer>
      <FieldContainer @label='Social Links'>
        <@fields.socialLinks />
      </FieldContainer>
      <FieldContainer @label='CRM App'>
        <@fields.crmApp />
      </FieldContainer>
      <FieldContainer @label='Status'>
        <@fields.statusTag />
      </FieldContainer>
    </div>
    <style scoped>
      .contact-form {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof Contact> {
  get hasSocialLinks() {
    return Boolean(this.args.model?.socialLinks?.length);
  }

  <template>
    <article class='embedded-contact-card'>
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

      {{#if @model.statusTag.label}}
        <@fields.statusTag @format='atom' class='status-pill-atom' />
      {{/if}}
    </article>

    <style scoped>
      .embedded-contact-card {
        --entity-display-icon-size: 17px;
        --entity-display-title-font-weight: 300;
        --entity-display-content-font-weight: 300;
        --entity-display-content-gap: var(--boxel-sp-xs);
        --contact-card-fitted-padding: calc(var(--boxel-sp-lg) - 2px);
        width: 100%;
        height: 100%;
        padding: var(--boxel-sp-lg);
        overflow: hidden;
        display: grid;
        gap: var(--boxel-sp-sm);
        grid-template-areas:
          'avatar-group-container'
          'contact-info'
          'links'
          'status';
        grid-template-rows: max-content max-content auto max-content;
      }
      .avatar-group-container {
        grid-area: avatar-group-container;
      }
      .contact-info {
        grid-area: contact-info;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        font-size: var(--boxel-font-sm);
        color: var(--boxel-dark);
        word-break: break-word;
      }
      .links {
        grid-area: links;
        font-size: var(--boxel-font-xs);
        align-self: normal;
        margin-top: auto;
      }
      .links :deep(div) {
        display: flex;
        gap: var(--boxel-sp-xxxs);
        flex-wrap: wrap;
      }
      .links :deep(.pill) {
        --boxel-social-link-pill-size: calc(var(--boxel-font-size-2xl) + 2px);
        width: var(--boxel-social-link-pill-size);
        height: var(--boxel-social-link-pill-size);
        --default-pill-border: 1px solid var(--boxel-300);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .status-pill-atom {
        grid-area: status;
        width: fit-content;
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof Contact> {
  get hasSocialLinks() {
    return Boolean(this.args.model?.socialLinks?.length);
  }

  <template>
    <article class='contact-card-fitted'>
      <AvatarGroup
        @userId={{@model.id}}
        @name={{@model.name}}
        @thumbnailURL={{@model.thumbnailURL}}
        class='avatar-group-container'
      >
        <:content>
          <div class='company-name-atom'>
            <@fields.company @format='atom' @displayContainer={{false}} />
          </div>
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
      {{#if @model.statusTag.label}}
        <div class='status-pill-atom'>
          <@fields.statusTag @format='atom' />
        </div>
      {{/if}}

    </article>

    <style scoped>
      .contact-card-fitted {
        --entity-display-icon-size: 17px;
        --entity-display-title-font-weight: 300;
        --entity-display-content-font-weight: 300;
        --entity-display-content-gap: var(--boxel-sp-xs);
        width: 100%;
        height: 100%;
        min-width: 100px;
        min-height: 29px;
        overflow: hidden;
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
        grid-template-areas:
          'avatar-group-container'
          'contact-info'
          'links'
          'status';
        grid-template-rows: max-content max-content auto max-content;
      }
      .avatar-group-container {
        --avatar-name-font: 600 var(--boxel-font);
        grid-area: avatar-group-container;
      }
      .company-name-atom {
        --entity-display-content-font-size: var(--boxel-font-size-sm);
        --entity-display-title-line-clamp: 1;
      }
      .contact-info {
        grid-area: contact-info;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        font-size: var(--boxel-font-sm);
        color: var(--boxel-dark);
        word-break: break-word;
      }
      .status-pill-atom {
        grid-area: status;
        width: fit-content;
      }
      .links {
        grid-area: links;
        font-size: var(--boxel-font-xs);
        align-self: normal;
        margin-top: auto;
      }
      .links :deep(div) {
        display: flex;
        gap: var(--boxel-sp-xxxs);
        flex-wrap: wrap;
      }
      .links :deep(.pill) {
        --boxel-social-link-pill-size: calc(var(--boxel-font-size-2xl) + 2px);
        --default-pill-border: 1px solid var(--boxel-300);
        width: var(--boxel-social-link-pill-size);
        height: var(--boxel-social-link-pill-size);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      /* Vertical card (aspect-ratio <= 1.0) */
      @container fitted-card (aspect-ratio <= 1.0) {
        /* Base styles for smaller cards */
        .contact-card-fitted {
          padding: var(--boxel-sp-sm);
        }
        /* Height >= 400px */
        @container (height >= 400px) {
          .contact-card-fitted {
            grid-template-areas:
              'avatar-group-container'
              'contact-info'
              'links'
              'status';
            grid-template-rows: max-content max-content auto max-content;
            padding: var(--boxel-sp);
          }
        }

        /* 180px <= height <= 275px */
        @container (180px <= height <= 275px) {
          .contact-card-fitted {
            grid-template-areas:
              'avatar-group-container'
              'links'
              'status';
            grid-template-rows: max-content auto max-content;
          }
          .avatar-group-container {
            --avatar-thumbnail-size: 50px;
            --avatar-group-flex-direction: column;
            --avatar-group-align-items: flex-start;
            --avatar-name-font: 600 var(--boxel-font);
          }
          .contact-info {
            display: none;
          }
        }

        /* height < 180px */
        @container (height < 180px) {
          .contact-card-fitted {
            grid-template-areas:
              'avatar-group-container'
              'status';
            grid-template-rows: max-content auto;
          }
          .avatar-group-container {
            --avatar-thumbnail-size: 30px;
            gap: var(--boxel-sp-xxs);
          }
          .contact-info,
          .links {
            display: none;
          }
          .status-pill-atom {
            margin-top: auto;
          }
        }
      }

      /* Horizontal card (aspect-ratio > 1.0) */
      @container fitted-card (aspect-ratio > 1.0) {
        .contact-card-fitted {
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs);
        }

        .avatar-group-container {
          --avatar-thumbnail-size: 40px;
          gap: var(--boxel-sp-xs);
        }

        /* height >= 180px */
        @container (height >= 180px) {
          .contact-card-fitted {
            grid-template-areas:
              'avatar-group-container'
              'links'
              'status';
            grid-template-rows: max-content auto max-content;
          }
          .contact-info {
            display: none;
          }
        }

        /* 115px <= height < 180px */
        @container (115px <= height < 180px) {
          .contact-card-fitted {
            grid-template-areas:
              'avatar-group-container'
              'status';
            grid-template-rows: max-content auto;
          }
          .avatar-group-container {
            --avatar-thumbnail-size: 30px;
            gap: var(--boxel-sp-xxs);
          }
          .contact-info,
          .links {
            display: none;
          }
          .status-pill-atom {
            margin-top: auto;
          }
        }

        /* 58px <= height < 115px */
        @container (58px <= height < 115px) {
          .contact-card-fitted {
            grid-template-areas: 'avatar-group-container';
            grid-template-rows: max-content;
          }
          .avatar-group-container {
            --avatar-thumbnail-size: 25px;
            --avatar-name-font: 600 var(--boxel-font);
          }
          .contact-info,
          .links,
          .status-pill-atom {
            display: none;
          }
        }

        /* height <= 57px */
        @container (height <= 57px) {
          .avatar-group-container {
            --avatar-thumbnail-size: 25px;
            --avatar-name-font: 600 var(--boxel-font);
            --avatar-info-content-display: none;
          }
        }
      }

      /* Special cases */
      @container fitted-card (aspect-ratio <= 0.5) and (height < 300px) {
        .contact-card-fitted {
          grid-template-areas:
            'avatar-group-container'
            'status'
            'links';
          grid-template-rows: max-content auto max-content;
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
      <EntityDisplayWithThumbnail @title={{this.label}} @underline={{true}}>
        <:thumbnail>
          <Avatar
            @userID={{@model.id}}
            @displayName={{@model.name}}
            @thumbnailURL={{@model.thumbnailURL}}
            @isReady={{true}}
            class='avatar'
          />
        </:thumbnail>
      </EntityDisplayWithThumbnail>
    </div>
    <style scoped>
      .contact {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0; /* Helps with text overflow */
      }
      .avatar {
        --profile-avatar-icon-size: 20px;
        --profile-avatar-icon-border: 0px;
        flex-shrink: 0;
      }
    </style>
  </template>
}

export class Contact extends CardDef {
  static displayName = 'Contact';
  static icon = ContactIcon;

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field position = contains(StringField);
  @field crmApp = linksTo(() => CrmApp);
  @field company = linksTo(() => Company);
  @field department = contains(StringField);
  @field primaryEmail = contains(EmailField);
  @field secondaryEmail = contains(EmailField);
  @field phoneMobile = contains(ContactPhoneNumber);
  @field phoneOffice = contains(ContactPhoneNumber);
  @field socialLinks = containsMany(SocialLinkField);
  @field statusTag = contains(StatusTagField); //this is an empty field that gets computed in subclasses

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

  @field email = contains(StringField, {
    computeVia: function (this: Contact) {
      return this.primaryEmail ?? this.secondaryEmail;
    },
  });

  static edit = EditTemplate;
  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
  static atom = AtomTemplate;
}
