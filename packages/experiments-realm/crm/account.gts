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

class IsolatedTemplate extends Component<typeof Account> {
  get logoURL() {
    return (
      this.args.model?.thumbnailURL ?? 'https://picsum.photos/id/237/200/300'
    );
  }

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
        <AccountHeader @logoURL={{this.logoURL}} @name={{@model.name}}>
          <:name>
            {{#if @model.name}}
              <h1 class='account-name'>{{@model.name}}</h1>
            {{else}}
              <h1 class='account-name'>Missing Account Name</h1>
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
                  Missing Company Info
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
                        @tagLabel={{contact.role}}
                      />
                    {{/if}}
                  {{/each}}
                {{else}}
                  Missing Contacts
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
        <h2 class='activities-title'>Activities</h2>
      </:activities>
    </AccountPageLayout>

    <style scoped>
      .account-name {
        font: 600 var(--boxel-font-lg);
        margin: 0;
      }
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
    </style>
  </template>
}

class UrgencyTag extends LooseGooseyField {
  static icon = CalendarExclamation;
  static displayName = 'CRM Urgency Tag';
  static values = [
    {
      index: 0,
      label: 'Overdue for Renewal',
      colorScheme: {
        foregroundColor: '#D32F2F', // Dark Red
        backgroundColor: '#FFEBEE', // Light Red
      },
    },
    {
      index: 1,
      label: 'Renewal Due Soon',
      colorScheme: {
        foregroundColor: '#F57C00', // Dark Orange
        backgroundColor: '#FFF3E0', // Light Orange
      },
    },
    {
      index: 2,
      label: 'Recently Renewed',
      colorScheme: {
        foregroundColor: '#388E3C', // Dark Green
        backgroundColor: '#E8F5E9', // Light Green
      },
    },
    {
      index: 3,
      label: 'Expiring Soon',
      colorScheme: {
        foregroundColor: '#FBC02D', // Dark Yellow
        backgroundColor: '#FFF9C4', // Light Yellow
      },
    },
    {
      index: 4,
      label: 'Inactive for X Days',
      colorScheme: {
        foregroundColor: '#757575', // Dark Grey
        backgroundColor: '#E0E0E0', // Light Grey
      },
    },
    {
      index: 5,
      label: 'Follow-Up Required',
      colorScheme: {
        foregroundColor: '#1976D2', // Dark Blue
        backgroundColor: '#E3F2FD', // Light Blue
      },
    },
    {
      index: 6,
      label: 'Pending Contract',
      colorScheme: {
        foregroundColor: '#512DA8', // Dark Purple
        backgroundColor: '#EDE7F6', // Light Purple
      },
    },
    {
      index: 7,
      label: 'Next Review Scheduled',
      colorScheme: {
        foregroundColor: '#558B2F', // Dark Olive Green
        backgroundColor: '#F1F8E9', // Light Olive Green
      },
    },
  ];

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
  @field name = contains(StringField, {
    computeVia: function (this: Account) {
      return this.company?.name;
    },
  });
  @field company = linksTo(Company);
  @field primaryContact = linksTo(Contact);
  @field contacts = linksToMany(Contact);
  @field shippingAddress = contains(AddressField);
  @field billingAddress = contains(AddressField);
  @field urgencyTag = contains(UrgencyTag);
  //From linked Company
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
