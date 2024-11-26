import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import {
  Component,
  CardDef,
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { IconButton, RadioInput, Pill } from '@cardstack/boxel-ui/components';
import Mail from '@cardstack/boxel-icons/mail';
import Phone from '@cardstack/boxel-icons/phone';
import BrandTwitter from '@cardstack/boxel-icons/brand-twitter';
import BrandLinkedin from '@cardstack/boxel-icons/brand-linkedin';
import Building from '@cardstack/boxel-icons/building';
import HeartHandshake from '@cardstack/boxel-icons/heart-handshake';
import TargetArrow from '@cardstack/boxel-icons/target-arrow';

export interface LooseyGooseyData {
  index: number;
  label: string;
  color?: string;
}

export class LooseGooseyField extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  static values: LooseyGooseyData[] = []; //help with the types

  get color() {
    return LooseGooseyField.values.find((value) => {
      return value.label === this.label;
    })?.color;
  }
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
    <div class='priority-field'>
      <RadioInput
        @groupDescription='Select Task Priority'
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
    </div>
  </template>
}

export class ContactStatusField extends LooseGooseyField {
  // loosey goosey pattern
  static displayName = 'status';

  static values = [
    { index: 0, label: 'Customer', color: 'var(--boxel-success)' },
    { index: 1, label: 'Lead', color: 'var(--boxel-purple-400)' },
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
  @field number = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      (+<@fields.country />) <@fields.area />-<@fields.number />
    </template>
  };
}

class FittedTemplate extends Component<typeof Contact> {
  private formatPhone(phoneMobile: any) {
    if (!phoneMobile) return undefined;
    return `+${phoneMobile.country} ${phoneMobile.area}-${phoneMobile.number}`;
  }

  private formatEmail(email: string) {
    if (!email) return undefined;
    return email;
  }

  private openSocialLink(url: string) {
    window.open(url, '_blank');
  }

  private getStatusIcon(label: string | undefined) {
    switch (label) {
      case 'Customer':
        return {
          icon: HeartHandshake,
          lightColor: '#8bff98',
          darkColor: '#01d818',
        };
      case 'Lead':
        return {
          icon: TargetArrow,
          lightColor: '#E6F4FF',
          darkColor: '#0090FF',
        };
      default:
        return null;
    }
  }

  <template>
    {{! template-lint-disable no-inline-styles }}
    {{! template-lint-disable style-concatenation }}
    <article class='fitted-contact-card'>
      <div class='avatar-container'>
        <div class='avatar'>
          <img src={{@model.thumbnailURL}} alt={{@model.name}} />
        </div>
        <div class='avatar-info'>
          <h3 class='name'>{{if @model.name @model.name 'Unnamed Contact'}}</h3>
          <div class='row'>
            <Building class='icon' />
            <span>{{@model.company}}</span>
          </div>
        </div>
      </div>

      <div class='contact-info'>
        {{#if @model.primaryEmail}}
          <div class='row'>
            <Mail class='icon gray' />
            <span>{{this.formatEmail @model.primaryEmail}}</span>
          </div>
        {{/if}}

        {{#if @model.secondaryEmail}}
          <div class='row'>
            <Mail class='icon gray' />
            <span>{{this.formatEmail @model.secondaryEmail}}</span>
          </div>
        {{/if}}

        {{#if @model.phoneMobile}}
          <div class='row'>
            <Phone class='icon gray' />
            <span>{{this.formatPhone @model.phoneMobile}}</span>
            <Pill class='pill-gray'>
              mobile
            </Pill>
          </div>
        {{/if}}

        {{#if @model.phoneOffice}}
          <div class='row'>
            <Phone class='icon gray' />
            <span>{{this.formatPhone @model.phoneOffice}}</span>
            <Pill class='pill-gray'>
              office
            </Pill>
          </div>
        {{/if}}
      </div>

      <div class='social-links'>
        {{#if @model.twitterURL}}
          <IconButton
            @onClick={{fn this.openSocialLink @model.twitterURL}}
            @icon={{BrandTwitter}}
            @width='20'
            @height='20'
            class='social-link'
          />
        {{/if}}
        {{#if @model.linkedInURL}}
          <IconButton
            @onClick={{fn this.openSocialLink @model.linkedInURL}}
            @icon={{BrandLinkedin}}
            @width='20'
            @height='20'
            class='social-link'
          />
        {{/if}}
      </div>

      {{#if @model.status.label}}
        {{#let (this.getStatusIcon @model.status.label) as |statusIcon|}}
          <Pill
            class='status-pill'
            data-test-selected-type={{@model.status.label}}
            style='background-color: {{statusIcon.lightColor}};'
          >
            <:iconLeft>
              <IconButton
                @icon={{statusIcon.icon}}
                class='status-icon'
                style='background-color: {{statusIcon.darkColor}};'
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
        padding: var(--boxel-sp-sm);
        overflow: hidden;
      }
      .avatar-container {
        grid-area: avatar-container;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        min-width: 0;
      }
      .avatar {
        grid-area: img;
        background-color: var(--boxel-200);
        width: 60px;
        height: 60px;
        overflow: hidden;
        flex-shrink: 0;
        border-radius: 50%;
      }
      .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .avatar-info {
        display: inline-flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
        min-width: 0;
        flex: 1;
      }
      .name {
        grid-area: name;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 1;
        overflow: hidden;
        margin: 0;
        font-size: 1.1rem;
        letter-spacing: var(--boxel-lsp-sm);
      }
      .contact-info {
        grid-area: contact-info;
        font-size: var(--boxel-font-xs);
        margin-top: var(--boxel-sp);
      }
      .contact-info > * + * {
        margin-top: var(--boxel-sp-xs);
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
        font-weight: 300;
        font-size: 10px;
        word-break: keep-all;
        --pill-background-color: var(--boxel-200);
        border: none;
      }
      .social-links {
        grid-area: social-links;
        display: flex;
        align-items: center;
        overflow: hidden;
        gap: var(--boxel-sp-xxs);
        margin-top: var(--boxel-sp);
      }
      .social-link {
        --boxel-icon-button-width: var(--boxel-icon-med);
        --boxel-icon-button-height: var(--boxel-icon-med);
        border: 1px solid var(--boxel-300);
        border-radius: 5px;
      }
      .social-link:hover {
        border-color: var(--boxel-400);
        cursor: pointer;
      }
      .status-pill {
        grid-area: status-pill;
        display: inline-flex;
        align-items: center;
        overflow: hidden;
        padding: 0;
        margin-top: var(--boxel-sp);
        border: none;
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
        gap: var(--boxel-sp-xxs);
      }
      .row > span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @container fitted-card (width > 350px) {
        .fitted-contact-card {
          grid-template:
            'avatar-container'
            'contact-info' max-content
            'status-pill';

          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-sm);
        }
      }
    </style>
  </template>
}

export class Contact extends CardDef {
  static displayName = 'Contact';
  @field name = contains(StringField);
  @field thumbnailURL = contains(StringField);
  @field primaryEmail = contains(StringField);
  @field secondaryEmail = contains(StringField);
  @field phoneMobile = contains(PhoneField);
  @field phoneOffice = contains(PhoneField);
  @field twitterURL = contains(StringField);
  @field linkedInURL = contains(StringField);
  @field company = contains(StringField);
  @field status = contains(ContactStatusField);

  @field title = contains(StringField, {
    computeVia: function (this: Contact) {
      return this.name;
    },
  });

  static fitted = FittedTemplate;
}
