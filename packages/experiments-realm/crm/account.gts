import {
  CardDef,
  linksTo,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import {
  field,
  linksToMany,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Address as AddressField } from '../address';
import { Company } from './company';
import { Contact, StatusTagField } from './contact';
import SummaryCard from '../components/summary-card';
import SummaryGridContainer from '../components/summary-grid-container';
import BuildingIcon from '@cardstack/boxel-icons/building';
import ChartBarPopular from '@cardstack/boxel-icons/chart-bar-popular';
import AccountHeader from '../components/account-header';
import { WebsiteField } from '../website';
import { ContactRow } from '../components/contact-row';
import TrendingUp from '@cardstack/boxel-icons/trending-up';
import ContactIcon from '@cardstack/boxel-icons/contact';
import CalendarExclamation from '@cardstack/boxel-icons/calendar-exclamation';
import { LooseGooseyField } from '../loosey-goosey';
import { StatusPill } from '../components/status-pill';
import { Avatar, Pill, BoxelButton } from '@cardstack/boxel-ui/components';
import { EntityDisplay } from '../components/entity-display';
import ActivityCard from '../components/activity-card';
import PlusIcon from '@cardstack/boxel-icons/plus';
import PhoneIcon from '@cardstack/boxel-icons/phone';
import SquareUser from '@cardstack/boxel-icons/square-user';
import CalendarTime from '@cardstack/boxel-icons/calendar-time';
import ClockExclamation from '@cardstack/boxel-icons/clock-exclamation';
import Clock24 from '@cardstack/boxel-icons/clock-24';
import Handshake from '@cardstack/boxel-icons/handshake';
import ClockX from '@cardstack/boxel-icons/clock-x';
import ClockUp from '@cardstack/boxel-icons/clock-up';
import Contract from '@cardstack/boxel-icons/contract';

export const urgencyTagValues = [
  {
    index: 0,
    icon: ClockExclamation,
    label: 'Overdue for Renewal',
    value: 'Create Account', // TODO: For the createNewButtonText usage in CRM App
    colorScheme: {
      foregroundColor: '#D32F2F', // Dark Red
      backgroundColor: '#FFEBEE', // Light Red
    },
  },
  {
    index: 1,
    icon: Clock24,
    label: 'Renewal Due Soon',
    value: 'Create Account',
    colorScheme: {
      foregroundColor: '#F57C00', // Dark Orange
      backgroundColor: '#FFF3E0', // Light Orange
    },
  },
  {
    index: 2,
    icon: Handshake,
    label: 'Recently Renewed',
    value: 'Create Account',
    colorScheme: {
      foregroundColor: '#388E3C', // Dark Green
      backgroundColor: '#E8F5E9', // Light Green
    },
  },
  {
    index: 3,
    icon: ClockX,
    label: 'Expiring Soon',
    value: 'Create Account',
    colorScheme: {
      foregroundColor: '#FBC02D', // Dark Yellow
      backgroundColor: '#FFF9C4', // Light Yellow
    },
  },
  {
    index: 4,
    icon: ClockUp,
    label: 'Follow-Up Required',
    value: 'Create Account',
    colorScheme: {
      foregroundColor: '#1976D2', // Dark Blue
      backgroundColor: '#E3F2FD', // Light Blue
    },
  },
  {
    index: 5,
    icon: Contract,
    label: 'Pending Contract',
    value: 'Create Account',
    colorScheme: {
      foregroundColor: '#512DA8', // Dark Purple
      backgroundColor: '#EDE7F6', // Light Purple
    },
  },
  {
    index: 6,
    icon: CalendarTime,
    label: 'Next Review Scheduled',
    value: 'Create Account',
    colorScheme: {
      foregroundColor: '#558B2F', // Dark Olive Green
      backgroundColor: '#F1F8E9', // Light Olive Green
    },
  },
];

class IsolatedTemplate extends Component<typeof Account> {
  get hasCompanyInfo() {
    return this.args.model?.website || this.args.model?.headquartersAddress;
  }

  get hasContacts() {
    return (
      this.args.model.primaryContact?.name ||
      (this.args.model.contacts?.length ?? 0) > 0 //contacts is a proxy array
    );
  }

  <template>
    <AccountPageLayout>
      <:header>
        <AccountHeader @logoURL={{@model.thumbnailURL}} @name={{@model.name}}>
          <:name>
            {{#if @model.name}}
              <h1 class='account-name'>{{@model.name}}</h1>
            {{else}}
              <h1 class='account-name default-value'>Missing Account Name</h1>
            {{/if}}
          </:name>
          <:content>
            <div class='description content-container'>
              {{#if @model.primaryContact}}
                <@fields.primaryContact
                  @format='atom'
                  @displayContainer={{false}}
                  class='primary-contact'
                />
                <div class='tag-container'>
                  <@fields.statusTag @format='atom' />
                  <@fields.urgencyTag @format='atom' />
                </div>
              {{/if}}
            </div>
          </:content>
        </AccountHeader>
      </:header>

      <:summary>
        <SummaryGridContainer>
          <SummaryCard>
            <:title>
              <h3 class='summary-title'>Company Info</h3>
            </:title>
            <:icon>
              <BuildingIcon class='header-icon' />
            </:icon>
            <:content>
              <div class='description content-container'>
                {{#if this.hasCompanyInfo}}
                  <@fields.headquartersAddress @format='atom' />
                  <@fields.website @format='atom' />
                {{else}}
                  <div class='default-value'>
                    Missing Company Info
                  </div>
                {{/if}}
              </div>
            </:content>
          </SummaryCard>

          <SummaryCard>
            <:title>
              <h3 class='summary-title'>Contacts</h3>
            </:title>
            <:icon>
              <ContactIcon class='header-icon' />
            </:icon>
            <:content>
              <div class='description content-container'>
                {{#if this.hasContacts}}
                  {{#if @model.primaryContact}}
                    <ContactRow
                      @userID={{@model.primaryContact.id}}
                      @name={{@model.primaryContact.name}}
                      @thumbnailURL={{@model.primaryContact.thumbnailURL}}
                      @tagLabel='primary'
                    />
                  {{/if}}
                  {{#each @model.contacts as |contact|}}
                    {{#if contact}}
                      <ContactRow
                        @userID={{contact.id}}
                        @name={{contact.name}}
                        @thumbnailURL={{contact.thumbnailURL}}
                        @tagLabel={{contact.position}}
                      />
                    {{/if}}
                  {{/each}}
                {{else}}
                  <div class='default-value'>
                    Missing Contacts
                  </div>
                {{/if}}
              </div>
            </:content>
          </SummaryCard>

          <SummaryCard>
            <:title>
              <h3 class='summary-title'>Lifetime Value</h3>
            </:title>
            <:icon>
              <ChartBarPopular class='header-icon' />
            </:icon>
            <:content>
              <h3 class='summary-highlight'>Desc</h3>
              <p class='description'>Desc</p>
            </:content>
          </SummaryCard>

          <SummaryCard>
            <:title>
              <h3 class='summary-title'>Active Deals</h3>
            </:title>
            <:icon>
              <TrendingUp class='header-icon' />
            </:icon>
            <:content>
              <h3 class='summary-highlight'>Desc</h3>
              <p class='description'>Desc</p>
            </:content>
          </SummaryCard>
        </SummaryGridContainer>
      </:summary>

      <:activities>
        <SummaryCard class='activities-summary-card'>
          <:title>
            <h2 class='activity-title'>Recent Activities</h2>
          </:title>
          <:icon>
            <BoxelButton
              @kind='primary'
              class='activity-button-mobile'
              data-test-settings-button
            >
              <PlusIcon />
            </BoxelButton>

            <BoxelButton
              @kind='primary'
              @size='base'
              class='activity-button-desktop'
              data-test-settings-button
            >
              <PlusIcon />
              New Activity
            </BoxelButton>
          </:icon>
          <:content>
            <ActivityCard>
              <:thumbnail>
                <PhoneIcon />
              </:thumbnail>
              <:title>
                Customer Call
              </:title>
              <:icon>
                <Pill class='activity-pill'>
                  Left VoiceMail
                </Pill>
              </:icon>
              <:description>
                Discuss Q3 product roadmap
              </:description>
              <:content>
                <div class='activity-card-group'>
                  <EntityDisplay>
                    <:thumbnail>
                      <SquareUser />
                    </:thumbnail>
                    <:title>
                      Dmitri Petrov
                    </:title>
                    <:content>
                      Technova
                    </:content>
                  </EntityDisplay>
                  <EntityDisplay>
                    <:thumbnail>
                      <Avatar
                        @thumbnailURL='https://images.pexels.com/photos/1624229/pexels-photo-1624229.jpeg?auto=compress&cs=tinysrgb&w=300&h=300&dpr=2'
                      />
                    </:thumbnail>
                    <:title>
                      Rep: Janus Dios
                    </:title>
                    <:content>
                      Sales Associate
                    </:content>
                  </EntityDisplay>
                  <EntityDisplay class='activity-time'>
                    <:thumbnail>
                      <CalendarTime />
                    </:thumbnail>
                    <:title>
                      May 15, 2024
                    </:title>
                    <:content>
                      3:15pm
                    </:content>
                  </EntityDisplay>
                </div>
              </:content>
            </ActivityCard>
          </:content>
        </SummaryCard>
      </:activities>
    </AccountPageLayout>

    <style scoped>
      h1,
      h2,
      h3,
      p {
        margin: 0;
      }
      .account-name {
        font: 600 var(--boxel-font-lg);
        margin: 0;
      }
      /* Summary */
      .summary-title {
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xxs);
        margin: 0;
      }
      .header-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        flex-shrink: 0;
        margin-left: auto;
      }
      .summary-highlight {
        font: 600 var(--boxel-font-lg);
        margin: 0;
      }
      .primary-contact {
        width: fit-content;
        display: inline-block;
      }
      .description {
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .content-container {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .tag-container {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }
      .default-value {
        color: var(--boxel-400);
      }
      /* Activities */
      .activity-button-mobile {
        display: none;
      }
      .activity-button-desktop {
        display: inline-flex;
      }
      .activities-summary-card {
        --summary-card-padding: var(--boxel-sp-xl) var(--boxel-sp);
        container-type: inline-size;
        container-name: activities-summary-card;
      }
      .activity-title {
        font: 600 var(--boxel-font-med);
        letter-spacing: var(--boxel-lsp-xxs);
        margin: 0;
      }
      .activity-pill {
        --pill-background-color: var(--boxel-200);
      }
      .activity-card-group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp);
      }
      .activity-time {
        font-size: var(--boxel-font-xs);
        color: var(--boxel-color-gray);
        margin-left: auto;
      }

      @container activities-summary-card (max-width: 447px) {
        .activity-button-mobile {
          display: inline-flex;
          --boxel-button-padding: 0px 0px;
          min-width: 2rem;
        }
        .activity-button-desktop {
          display: none;
        }
        .activity-card-group {
          flex-direction: column;
          align-items: flex-start;
        }
        .activity-time {
          margin-left: 0;
        }
      }
    </style>
  </template>
}

class UrgencyTag extends LooseGooseyField {
  static icon = CalendarExclamation;
  static displayName = 'CRM Urgency Tag';
  static values = urgencyTagValues;

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.label}}
        <StatusPill
          @label={{@model.label}}
          @icon={{@model.constructor.icon}}
          @iconDarkColor={{@model.colorScheme.foregroundColor}}
          @iconLightColor={{@model.colorScheme.backgroundColor}}
        />
      {{/if}}
    </template>
  };
}

export class Account extends CardDef {
  static displayName = 'CRM Account';
  @field company = linksTo(Company);
  @field primaryContact = linksTo(Contact);
  @field contacts = linksToMany(Contact);
  @field shippingAddress = contains(AddressField);
  @field billingAddress = contains(AddressField);
  @field urgencyTag = contains(UrgencyTag);

  @field name = contains(StringField, {
    computeVia: function (this: Account) {
      return this.company?.name;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field headquartersAddress = contains(AddressField, {
    computeVia: function (this: Account) {
      return this.company?.headquartersAddress;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field website = contains(WebsiteField, {
    computeVia: function (this: Account) {
      return this.company?.website;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field statusTag = contains(StatusTagField, {
    computeVia: function (this: Account) {
      return this.primaryContact?.statusTag;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: Account) {
      return this.company?.name;
    },
  });

  static isolated = IsolatedTemplate;
}

interface AccountPageLayoutArgs {
  Blocks: {
    header: [];
    summary: [];
    activities: [];
  };
  Element: HTMLElement;
}

class AccountPageLayout extends GlimmerComponent<AccountPageLayoutArgs> {
  <template>
    <div class='account-page-layout' ...attributes>
      {{yield to='header'}}
      {{yield to='summary'}}
      {{yield to='activities'}}
    </div>

    <style scoped>
      .account-page-layout {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        width: 100%;
        padding: 20px;
        box-sizing: border-box;
      }
    </style>
  </template>
}
