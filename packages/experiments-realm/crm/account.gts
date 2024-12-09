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
import { Contact } from './contact';
import SummaryCard from '../components/summary-card';
import SummaryGridContainer from '../components/summary-grid-container';
import BuildingIcon from '@cardstack/boxel-icons/captions';
import AccountHeader from '../components/account-header';
import { WebsiteField } from '../website';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import { Avatar, Pill } from '@cardstack/boxel-ui/components';
import { EntityDisplay } from '../components/entity-display';

// Perhaps, can be address?
export class LocationField extends AddressField {
  static icon = MapPinIcon;
  static displayName = 'Location';
  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.country.name}}
        <div class='row'>
          <MapPinIcon class='icon' />
          <span>{{@model.city}}, {{@model.country.code}}</span>
        </div>
      {{/if}}
      <style scoped>
        .row {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
        }
        .icon {
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          flex-shrink: 0;
        }
      </style>
    </template>
  };
}

interface ContactRowArgs {
  Args: {
    userID: string;
    name: string;
    thumbnailURL: string;
    isPrimary: boolean;
  };
  Blocks: {};
  Element: HTMLElement;
}

class ContactRow extends GlimmerComponent<ContactRowArgs> {
  <template>
    <EntityDisplay @name={{@name}}>
      <:thumbnail>
        <Avatar
          @userID={{@userID}}
          @displayName={{@name}}
          @thumbnailURL={{@thumbnailURL}}
          @isReady={{true}}
          class='avatar'
        />
      </:thumbnail>
      <:tag>
        {{#if this.args.isPrimary}}
          <Pill class='primary-tag' @pillBackgroundColor='#e8e8e8'>
            Primary
          </Pill>
        {{/if}}
      </:tag>
    </EntityDisplay>
    <style scoped>
      .avatar {
        --profile-avatar-icon-size: 30px;
        flex-shrink: 0;
      }
      .primary-tag {
        --pill-font-weight: 400;
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-6xs);
        --pill-font: 400 var(--boxel-font-sm);
        --pill-border: none;
      }
    </style>
  </template>
}

class IsolatedTemplate extends Component<typeof Account> {
  //Mock Data:
  get logoURL() {
    return 'https://picsum.photos/id/237/200/300';
  }

  get companyName() {
    return 'TechNova Solutions';
  }

  get hasCompanyInfo() {
    return this.args.model.website || this.args.model.address?.country?.name;
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
        <AccountHeader @logoURL={{this.logoURL}} @name={{this.companyName}}>
          <:name>
            <h1 class='account-name'>{{this.companyName}}</h1>
          </:name>
          <:content>
            <div class='description'>
              <@fields.primaryContact
                @format='atom'
                @displayContainer={{false}}
                class='primary-contact'
              />
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
              {{#if this.hasCompanyInfo}}
                <div class='description'>
                  <@fields.website @format='atom' />
                  <@fields.address @format='atom' />
                </div>
              {{else}}
                Missing Company Info
              {{/if}}
            </:content>
          </SummaryCard>

          <SummaryCard>
            <:title>
              <h3 class='summary-title'>Contacts</h3>
            </:title>
            <:icon>
              <BuildingIcon class='header-icon' />
            </:icon>
            <:content>
              <div class='description'>
                {{#if this.hasContacts}}
                  {{#if @model.primaryContact}}
                    <ContactRow
                      @userID={{@model.primaryContact.id}}
                      @name={{@model.primaryContact.name}}
                      @thumbnailURL={{@model.primaryContact.thumbnailURL}}
                      @isPrimary={{true}}
                    />
                  {{/if}}
                  {{#each @model.contacts as |contact|}}
                    {{#if contact}}
                      <ContactRow
                        @userID={{contact.id}}
                        @name={{contact.name}}
                        @thumbnailURL={{contact.thumbnailURL}}
                        @isPrimary={{false}}
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
              <BuildingIcon class='header-icon' />
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
              <BuildingIcon class='header-icon' />
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
        margin: 0;
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

export class Account extends CardDef {
  static displayName = 'CRM Account';

  @field company = linksTo(Company);
  @field primaryContact = linksTo(Contact);
  @field contacts = linksToMany(Contact);
  @field address = contains(LocationField);
  @field shippingAddress = contains(AddressField);
  @field billingAddress = contains(AddressField);
  @field website = contains(WebsiteField);

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
