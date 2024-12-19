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
import { Avatar, Pill, BoxelButton } from '@cardstack/boxel-ui/components';
import { EntityDisplay } from '../components/entity-display';
import ActivityCard from '../components/activity-card';
import PlusIcon from '@cardstack/boxel-icons/plus';
import PhoneIcon from '@cardstack/boxel-icons/phone';
import SquareUser from '@cardstack/boxel-icons/square-user';
import CalendarTime from '@cardstack/boxel-icons/calendar-time';

// Perhaps, can be address?
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
    <EntityDisplay>
      <:title>
        {{@name}}
      </:title>
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
        {{#if @isPrimary}}
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
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --pill-font: 400 var(--boxel-font-xs);
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
            <h1 class='account-name'>{{@model.name}}</h1>
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
              <div class='description'>
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
              <:header>
                <EntityDisplay>
                  <:title>
                    <span class='activity-card-title'>
                      Customer Call
                    </span>
                  </:title>
                  <:thumbnail>
                    <PhoneIcon />
                  </:thumbnail>
                </EntityDisplay>
              </:header>
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
                        class='avatar'
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
      .avatar {
        flex-shrink: 0;
        --profile-avatar-icon-size: 25px;
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
        margin: 0;
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
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
      .activity-card-title {
        font-size: var(
          --activity-card-title-font-size,
          var(--boxel-font-size-sm)
        );
        font-weight: var(--activity-card-title-font-weight, 600);
        margin: 0;
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
