import StringField from 'https://cardstack.com/base/string';
import {
  CardDef,
  linksTo,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import { field, linksToMany } from 'https://cardstack.com/base/card-api';
import { Company } from './company';
import { Contact } from './contact';
import { Deal } from './deal';
import { htmlSafe } from '@ember/template';
import type IconComponent from '@cardstack/boxel-icons/captions';

const setBackgroundImage = (backgroundURL: string | null | undefined) => {
  if (!backgroundURL) {
    return;
  }
  return htmlSafe(`background-image: url(${backgroundURL});`);
};

class IsolatedTemplate extends Component<typeof Account> {
  <template>
    <article class='account-card'>
      {{! Header Section }}
      <header class='header'>
        <div class='logo-section'>
          <div
            class='company-logo'
            style={{setBackgroundImage @model.company.logoUrl}}
          />
          <div class='company-info'>
            <h1 class='company-name'>{{@model.company.name}}</h1>
            {{#if @model.primaryContact.position}}
              <div class='contact-role-badge'>{{@model.primaryContact.name}}
                -
                {{@model.primaryContact.position}}</div>
            {{/if}}
          </div>
        </div>
        <div class='tags'>
          {{!tags here for status}}
        </div>
      </header>

      <section class='dashboard-wrapper'>
        <div class='dashboard-grid'>
          {{! Company Info Section }}
          <ContentCard @title='Company Info'>
            {{#if @model.company.website}}
              <div class='info-row'>
                <a
                  href={{@model.company.website}}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  {{@model.company.website}}
                </a>
              </div>
            {{/if}}

            {{#if @model.companyLocation}}
              <div class='info-row'>
                <span class='company-location'>{{@model.companyLocation}}</span>
              </div>
            {{/if}}
          </ContentCard>

          {{! Contacts Section }}
          <ContentCard @title='Contacts'>
            <div class='contacts-list'>
              {{#each @model.contacts as |contact|}}
                <div class='contact-row'>
                  <span class='contact-name'>{{contact.name}}</span>
                </div>
              {{/each}}
            </div>
          </ContentCard>

          {{! Lifetime Value Section }}
          <ContentCard @title='Lifetime Value'>
            <div class='value-content'>
              <div class='total-value'>$792.1k</div>
              <div class='yearly-value'>+$92.5k in 2024</div>
            </div>
          </ContentCard>

          {{! Active Deals Section }}
          <ContentCard @title='Active Deals'>
            <div class='deals-content'>
              <div class='deals-count'>{{@model.deals.length}}</div>
              {{#if @model.deals}}
                <div class='deals-value'>$35.5k total value</div>
              {{/if}}
            </div>
          </ContentCard>
        </div>
      </section>
    </article>

    <style scoped>
      .account-card {
        padding: var(--boxel-sp);
        max-width: 1200px;
        margin: 0 auto;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--boxel-sp-lg);
      }

      .logo-section {
        display: flex;
        gap: var(--boxel-sp);
        align-items: center;
      }

      .company-logo {
        width: 64px;
        height: 64px;
        border-radius: 8px;
        flex-shrink: 0;
        background-color: var(--boxel-200);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
      }

      .company-name {
        font-size: var(--boxel-font-lg);
        margin: 0;
      }

      .contact-role-badge {
        font-weight: 500;
        text-decoration: underline;
      }

      .tags {
        display: flex;
        gap: var(--boxel-sp-sm);
      }

      .tag {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border-radius: 16px;
        font-size: var(--boxel-font-sm);
      }

      .tag.customer {
        background: #8bff98;
        color: #01d818;
      }

      .tag.renewal {
        background: #fff3dc;
        color: #ffa726;
      }

      .dashboard-wrapper {
        container-type: inline-size;
        display: block;
      }

      .dashboard-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--boxel-sp);
        align-items: stretch;
      }

      .info-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-sm);
        color: var(--boxel-purple-400);
      }

      .info-row a {
        color: inherit;
        text-decoration: none;
      }

      .info-row a:hover {
        text-decoration: underline;
      }

      .section-title {
        font-size: var(--boxel-font-sm);
        margin: 0 0 var(--boxel-sp);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .total-value,
      .deals-count {
        font-size: var(--boxel-font-size-xl);
        font-weight: 600;
      }

      .yearly-value,
      .deals-value {
        font-size: var(--boxel-font-size-xs);
      }

      @container (max-width: 600px) {
        .dashboard-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

export class Account extends CardDef {
  static displayName = 'Account';

  @field company = linksTo(Company);
  @field primaryContact = linksTo(Contact);
  @field contacts = linksToMany(Contact);
  @field deals = linksToMany(Deal);

  @field companyLocation = contains(StringField, {
    computeVia: function (this: Account) {
      if (!this.company?.location) {
        return undefined;
      }
      return `${this.company.location.city}, ${this.company.location.country}`;
    },
  });

  @field primaryContactInfo = contains(StringField, {
    computeVia: function (this: Account) {
      if (!this.primaryContact?.name || !this.primaryContact?.position) {
        return undefined;
      }
      return `${this.primaryContact.name} - ${this.primaryContact.position}`;
    },
  });

  static isolated = IsolatedTemplate;
}

interface ContentCardArgs {
  Args: {
    title: string;
    icon?: typeof IconComponent;
    children?: any;
  };
  Blocks: {
    default: [];
  };
}

export default class ContentCard extends GlimmerComponent<ContentCardArgs> {
  <template>
    <div class='content-card'>
      <div class='header'>
        <h2 class='title'>
          {{#if @icon}}
            <@icon class='header-icon' />
          {{/if}}
          {{@title}}
        </h2>
      </div>
      <div class='content'>
        {{yield}}
      </div>
    </div>

    <style scoped>
      .content-card {
        background: var(--boxel-light);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius-xl);
        padding: var(--boxel-sp-sm);
        height: 100%;
        min-height: 120px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        overflow: hidden;
        min-width: 0;
      }

      .header {
        display: flex;
        align-items: center;
        margin-bottom: var(--boxel-sp-sm);
      }

      .title {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-sm);
        font-weight: 600;
        margin: 0;
      }

      .header-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        color: var(--boxel-purple);
      }
    </style>
  </template>
}
