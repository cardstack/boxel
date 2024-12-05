import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';

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
import { htmlSafe } from '@ember/template';
import { IconButton, RadioInput, Pill } from '@cardstack/boxel-ui/components';
import MailIcon from '@cardstack/boxel-icons/mail';
import PhoneIcon from '@cardstack/boxel-icons/phone';
import HeartHandshakeIcon from '@cardstack/boxel-icons/heart-handshake';
import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';
import AvatarGroup from '../components/avatar-group';
import { Company } from './company';

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

const formatPhone = (phone: any) => {
  if (!phone) return undefined;
  return `+${phone.country} (${phone.area}) ${phone.phoneNumber}`;
};

const formatEmail = (email: string) => {
  if (!email) return undefined;
  return email;
};

export interface LooseyGooseyData {
  index: number;
  label: string;
  icon: any;
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
      {{#if @model.id}}
        <AvatarGroup
          @userID={{@model.id}}
          @name={{@model.name}}
          @thumbnailURL={{@model.thumbnailURL}}
        >
          <:content>
            <@fields.company
              @format='atom'
              @displayContainer={{false}}
              class='company-container'
            />
          </:content>
        </AvatarGroup>
      {{/if}}

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
        color: var(--boxel-400);
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
      {{#if @model.id}}
        <AvatarGroup
          @userID={{@model.id}}
          @name={{@model.name}}
          @thumbnailURL={{@model.thumbnailURL}}
        >
          <:content>
            <@fields.company
              @format='atom'
              @displayContainer={{false}}
              class='company-container'
            />
          </:content>
        </AvatarGroup>
      {{/if}}

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

        {{#if @model.phoneMobile}}
          <div class='row primary-phone'>
            <PhoneIcon class='icon gray' />
            <span>{{formatPhone @model.phoneMobile}}</span>
            <Pill class='pill-gray'>
              mobile
            </Pill>
          </div>
        {{/if}}

        {{#if @model.phoneOffice}}
          <div class='row secondary-phone'>
            <PhoneIcon class='icon gray' />
            <span>{{formatPhone @model.phoneOffice}}</span>
            <Pill class='pill-gray'>
              office
            </Pill>
          </div>
        {{/if}}
      </div>

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
        min-width: 100px;
        min-height: 29px;
        overflow: hidden;
        display: flex;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-xs);
      }
      .contact-info {
        font-size: var(--boxel-font-xs);
        align-self: normal;
      }
      .contact-info > * + * {
        margin-top: var(--boxel-sp-xxs);
      }
      .icon {
        width: var(--boxel-icon-xs);
        height: var(--boxel-icon-xs);
        flex-shrink: 0;
      }
      .icon.gray {
        color: var(--boxel-400);
      }
      .pill-gray {
        font-weight: 300;
        font-size: 10px;
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
        --boxel-icon-button-width: 25px;
        --boxel-icon-button-height: 25px;
      }
      .status-label-text {
        display: block;
        font-size: 10px;
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
      @container fitted-card ((aspect-ratio = 1.0) or ((aspect-ratio < 1.0) and (height < 226px))) {
        .fitted-contact-card {
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: var(--boxel-sp-xs);
        }

        .contact-info,
        .status-pill,
        .primary-email,
        .secondary-email,
        .secondary-phone,
        .pill-gray {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (226px < height) {
        .fitted-contact-card {
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: var(--boxel-sp-xs);
        }

        .status-pill {
          align-self: flex-end;
        }

        .primary-email,
        .secondary-email,
        .secondary-phone,
        .pill-gray {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (58px <= height < 180px)) {
        .fitted-contact-card {
          align-items: center;
          align-content: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xxs);
        }

        .primary-email,
        .secondary-email,
        .secondary-phone,
        .pill-gray {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (500px <= width) and (58px <= height <= 77px)) {
        .fitted-contact-card {
          align-items: center;
          align-content: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xxs);
        }

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
          justify-content: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-sm);
        }

        .primary-email,
        .secondary-email,
        .secondary-phone,
        .pill-gray {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (115px <= height < 180px)) {
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
          display: flex;
          align-items: center;
          padding: var(--boxel-sp-sm);
        }

        .contact-info,
        .status-pill {
          display: none;
        }
      }

      /* Smallest horizontal layout */
      @container fitted-card ((1.0 < aspect-ratio) and (50px <= height < 58px)) {
        .fitted-contact-card {
          display: flex;
          align-items: center;
          align-content: center;
          padding: var(--boxel-sp-xxxs);
        }

        .contact-info,
        .status-pill,
        .company-container {
          display: none;
        }
      }

      /* Fallback for extremely small sizes */
      @container fitted-card ((1.0 < aspect-ratio) and (height < 50px)) {
        .fitted-contact-card {
          grid-template: 'avatar-container';
          display: flex;
          align-items: center;
          align-content: center;
          padding: var(--boxel-sp-xxxs);
        }

        .name {
          font-size: var(--boxel-font-xs);
        }

        .contact-info,
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

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field company = linksTo(Company); // Links to the Company Card
  @field department = contains(StringField);
  @field primaryEmail = contains(StringField); // Stores primary email, format may change after final emailField PR is approved
  @field secondaryEmail = contains(StringField); // Stores secondary email, format may change after final emailField PR is approved
  @field phoneMobile = contains(PhoneField); // Stores mobile phone, format may change after final phoneField PR is approved
  @field phoneOffice = contains(PhoneField); // Stores office phone, format may change after final phoneField PR is approved
  @field status = contains(StatusField); // Stores status as a status field
  //@field socialLinks = containsMany(UrlField); // Pending format discussion with Burcu for consistency
  //@field account = linksTo(Account) // Pending completion of account card

  @field title = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });

  @field name = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });

  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}
