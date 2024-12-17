import {
  CardDef,
  contains,
  linksTo,
  StringField,
  field,
  linksToMany,
  containsMany,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import DateField from 'https://cardstack.com/base/date';
import GlimmerComponent from '@glimmer/component';
import SummaryCard from '../components/summary-card';
import SummaryGridContainer from '../components/summary-grid-container';
import UserSquare from '@cardstack/boxel-icons/user-square';
import { BoxelButton, Pill } from '@cardstack/boxel-ui/components';
import Info from '@cardstack/boxel-icons/info';
import AccountHeader from '../components/account-header';
import CrmProgressBar from '../components/crm-progress-bar';
import { EntityDisplay } from '../components/entity-display';
import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import { LooseGooseyField } from '../loosey-goosey';
import { Account } from './account';
import { action } from '@ember/object';
import { Tag } from '../tag';
import { PercentageField } from '../percentage';
import { MonetaryAmount } from '../monetary-amount';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Address as AddressField } from '../address';
import { WebsiteField } from '../website';
import { Contact } from './contact';
import { ContactRow } from '../components/contact-row';
import Users from '@cardstack/boxel-icons/users';
import World from '@cardstack/boxel-icons/world';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Document } from './document';

class IsolatedTemplate extends Component<typeof Deal> {
  get companyName() {
    return this.args.model.account?.name ?? 'No Company Name';
  }

  get logoURL() {
    return (
      this.args.model.thumbnailURL ??
      this.args.model.account?.thumbnailURL ??
      this.args.model.account?.company?.thumbnailURL ??
      'https://picsum.photos/id/237/200/300'
    );
  }

  get primaryContactName() {
    console.log(this.args.fields.account?.primaryContact);
    return this.args.model.account?.primaryContact?.name;
  }

  get hasCompanyInfo() {
    return (
      this.args.model?.account?.website ||
      this.args.model?.account?.headquartersAddress
    );
  }

  get hasStakeholders() {
    return (
      this.args.model.primaryStakeholder ||
      (this.args.model.stakeholders?.length ?? 0) > 0 //stakeholders is a proxy array
    );
  }

  @action
  viewDocument(id: string | undefined) {
    if (id && this.args.context?.actions?.viewCard) {
      this.args.context.actions.viewCard(new URL(id));
    } else {
      console.warn('Card opening functionality is not available here.');
    }
  }

  <template>
    <DealPageLayout>
      <:header>
        <AccountHeader @logoURL={{this.logoURL}} @name={{this.companyName}}>
          <:name>
            <h1 class='account-name'>{{this.companyName}}</h1>
          </:name>
          <:content>
            <@fields.primaryContact
              @format='atom'
              @displayContainer={{false}}
              class='primary-contact'
            />

            <div class='tag-container'>
              {{#if @model.status}}
                <Pill
                  style={{htmlSafe
                    (concat
                      'background-color: '
                      @model.status.colorScheme.backgroundColor
                      '; border-color: transparent;'
                    )
                  }}
                >{{@model.status.label}}</Pill>
              {{/if}}
              {{#if @model.priority}}
                <Pill
                  style={{htmlSafe
                    (concat
                      'background-color: '
                      @model.priority.colorScheme.backgroundColor
                      '; border-color: transparent;'
                    )
                  }}
                >{{@model.priority.label}}</Pill>
              {{/if}}
            </div>
          </:content>
        </AccountHeader>
      </:header>

      <:dashboard>
        <SummaryCard class='dashboard'>
          <:title>
            <h2 class='summary-title'>Deal Value</h2>
          </:title>
          <:icon>
            {{#if @model.healthScore}}
              <div class='progress-container'>
                <label class='progress-label'>{{@model.healthScore}}% Health
                  Score</label>
                <CrmProgressBar
                  @value={{@model.healthScore}}
                  @max={{100}}
                  @color='var(--boxel-green)'
                />
              </div>
            {{/if}}
          </:icon>
          <:content>
            <article class='dashboard-cards'>
              <div class='block'>
                <label>Current Value:</label>
                <@fields.computedValue class='highlight-value' @format='atom' />
                <p class='description success-value'>Description</p>
              </div>
              <div class='block'>
                <label>Predicted Revenue:</label>
                <@fields.predictedRevenue
                  class='highlight-value'
                  @format='atom'
                />
                <p class='description secondary-value'>Based on similar events</p>
              </div>
              <div class='block'>
                <label>Profit Margin:</label>
                {{! TODO: compound fields have divs that wrap them. Seems a bit inconsistent.}}
                <div class='highlight-value'>
                  <@fields.profitMargin @format='atom' />
                </div>
                <p class='description secondary-value'>Estimated</p>
              </div>
            </article>

            <hr />

            <article class='value-breakdown'>
              <header>
                <label>Value Breakdown</label>
              </header>
              <table class='breakdown-table'>
                <tbody>
                  {{#each @fields.valueBreakdown as |item|}}
                    <tr>
                      <td class='item-name'>
                        <item.name />
                      </td>
                      <td class='item-value'>
                        <item.value />
                      </td>
                    </tr>
                  {{/each}}
                </tbody>
              </table>
            </article>

            <hr />

            <footer class='next-steps'>
              <div class='next-steps-row'>
                <EntityDisplay @center={{true}}>
                  <:title>
                    Next Steps
                  </:title>
                  <:thumbnail>
                    <Info class='info-icon' />
                  </:thumbnail>
                </EntityDisplay>

                {{#if @model.document}}
                  <BoxelButton
                    @as='button'
                    @size='extra-small'
                    @kind='secondary-light'
                    class='view-document-btn'
                    {{on 'click' (fn this.viewDocument @model.document.id)}}
                  >
                    View Document
                  </BoxelButton>
                {{/if}}
              </div>
              <@fields.notes />
            </footer>

          </:content>
        </SummaryCard>
      </:dashboard>

      <:summary>
        <SummaryGridContainer>
          <SummaryCard>
            <:title>
              <label>Company Info</label>
            </:title>
            <:icon>
              <World class='header-icon' />
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
              <label>Stakeholders</label>
            </:title>
            <:icon>
              <Users class='header-icon' />
            </:icon>
            <:content>
              <div class='description'>
                {{#if this.hasStakeholders}}
                  {{#if @model.primaryStakeholder}}
                    <ContactRow
                      @userID={{@model.primaryStakeholder.id}}
                      @name={{@model.primaryStakeholder.name}}
                      @thumbnailURL={{@model.primaryStakeholder.thumbnailURL}}
                      @tagLabel='primary'
                    />
                  {{/if}}
                  {{#each @model.stakeholders as |stakeholder|}}
                    <ContactRow
                      @userID={{stakeholder.id}}
                      @name={{stakeholder.name}}
                      @thumbnailURL={{stakeholder.thumbnailURL}}
                      @tagLabel={{stakeholder.position}}
                    />
                  {{/each}}
                {{/if}}
              </div>
            </:content>
          </SummaryCard>

        </SummaryGridContainer>
      </:summary>
    </DealPageLayout>

    <style scoped>
      h1,
      h2,
      h3,
      h4,
      p {
        margin: 0;
      }
      hr {
        border: 1px solid var(--boxel-200);
        margin: 1.3rem 0;
      }
      label {
        font-weight: 500;
      }
      .mt-5 {
        margin-top: 1rem;
      }
      .highlight-value {
        font: 600 var(--boxel-font-xl);
      }
      .secondary-value {
        font: 300 var(--boxel-font-sm);
        color: var(--boxel-400);
      }
      .success-value {
        font: 300 var(--boxel-font-sm);
        color: var(--boxel-dark-green);
      }
      .block {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
      }
      .dashboard {
        container-type: inline-size;
      }
      .dashboard-cards {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: var(--boxel-sp-xl);
        margin-top: var(--boxel-sp);
      }
      .account-name {
        font: 600 var(--boxel-font-lg);
      }
      .user-icon {
        margin-left: auto;
      }
      .info-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        flex-shrink: 0;
        margin-left: auto;
      }
      .tag-container {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        margin-top: var(--boxel-sp-xxs);
      }
      .summary-title {
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xxs);
        align-self: flex-start;
      }
      .summary-highlight {
        font: 600 var(--boxel-font-lg);
      }
      .description {
        margin: 0;
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .progress-container {
        display: flex;
        align-items: start;
        gap: var(--boxel-sp-xxs);
      }
      .progress-label {
        color: var(--boxel-500);
      }
      .breakdown-table {
        width: 90%;
        margin-left: auto;
        margin-right: 1rem;
        margin-top: 0.5rem;
      }
      .item-name,
      .item-value {
        padding: 8px;
        text-align: left;
      }
      .item-value {
        text-align: right;
        font-weight: 600;
      }
      /* footer */
      .next-steps-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-sm);
        font-weight: 600;
      }
      .view-document-btn {
        font-weight: 600;
        padding: 2px 5px;
        min-width: 0px;
        min-height: 0px;
      }
      @container (max-width: 447px) {
        .progress-container {
          flex-direction: column-reverse;
          align-items: flex-end;
        }
        .dashboard-cards {
          grid-template-columns: 1fr;
        }
      }
      .primary-contact {
        width: fit-content;
        display: inline-block;
      }
    </style>
  </template>
}

class DealStatus extends LooseGooseyField {
  static displayName = 'CRM Deal Status';
  static values = [
    {
      index: 0,
      label: 'Discovery',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: '#E3F2FD',
      },
    },
    {
      index: 1,
      label: 'Proposal',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: 'var(--boxel-lilac)',
      },
    },
    {
      index: 2,
      label: 'Negotiation',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: '#FFF3E0', // light orange
      },
    },
    {
      index: 3,
      label: 'Closed Won',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: '#E8F5E9', // light green
      },
    },
    {
      index: 4,
      label: 'Closed Lost',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: '#FFEBEE', // light red
      },
    },
  ];
}

export class DealPriority extends LooseGooseyField {
  static displayName = 'CRM Deal Priority';
  static values = [
    {
      index: 0,
      label: 'Low',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: '#E3F2FD',
      },
    },
    {
      index: 1,
      label: 'Medium',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: '#FFF0B3',
      },
    },
    {
      index: 2,
      label: 'High',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: 'var(--boxel-yellow)',
      },
    },
  ];
}

class Value extends MonetaryAmount {
  static displayName = 'CRM Value Amount';
  static atom = class Atom extends Component<typeof this> {
    <template>
      {{@model.formattedAmount}}
    </template>
  };
}

export class MonetaryLineItem extends FieldDef {
  static displayName = 'CRM Monetary Line Item';
  @field name = contains(StringField);
  @field value = contains(Value);

  static embedded = class Embedded extends Component<typeof MonetaryLineItem> {
    <template>
      <@fields.name /> <@fields.value />
    </template>
  };
}

export class Deal extends CardDef {
  static displayName = 'CRM Deal';
  @field name = contains(StringField);
  @field account = linksTo(() => Account);
  @field status = contains(DealStatus);
  @field priority = contains(DealPriority);
  @field closeDate = contains(DateField);
  @field currentValue = contains(MonetaryAmount);
  @field computedValue = contains(MonetaryAmount, {
    computeVia: function (this: Deal) {
      let total = this.valueBreakdown?.reduce((acc, item) => {
        return acc + item.value.amount;
      }, 0);
      let result = new MonetaryAmount();
      result.amount = total;
      result.currency = this.currentValue?.currency;
      return result;
    },
  });
  @field predictedRevenue = contains(MonetaryAmount);
  @field tags = linksToMany(() => Tag);
  @field profitMargin = contains(PercentageField, {
    computeVia: function (this: Deal) {
      if (!this.currentValue?.amount || !this.predictedRevenue?.amount) {
        return null;
      }
      return (this.currentValue?.amount / this.predictedRevenue?.amount) * 100;
    },
  });
  @field healthScore = contains(PercentageField);
  @field notes = contains(MarkdownField);
  @field document = linksTo(() => Document);
  @field primaryStakeholder = linksTo(() => Contact);
  @field stakeholders = linksToMany(() => Contact);
  @field valueBreakdown = containsMany(MonetaryLineItem);
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field headquartersAddress = contains(AddressField, {
    computeVia: function (this: Deal) {
      return this.account?.headquartersAddress;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field website = contains(WebsiteField, {
    computeVia: function (this: Deal) {
      return this.account?.website;
    },
  });
  @field primaryContact = linksTo(Contact, {
    computeVia: function (this: Deal) {
      return this.account?.primaryContact;
    },
  });
  static isolated = IsolatedTemplate;
}

interface DealPageLayoutArgs {
  Blocks: {
    header: [];
    dashboard: [];
    summary: [];
  };
  Element: HTMLElement;
}

class DealPageLayout extends GlimmerComponent<DealPageLayoutArgs> {
  <template>
    <div class='deal-page-layout' ...attributes>
      {{yield to='header'}}
      {{yield to='dashboard'}}
      {{yield to='summary'}}
    </div>

    <style scoped>
      .deal-page-layout {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        width: 100%;
        padding: var(--boxel-sp-lg);
        box-sizing: border-box;
      }
    </style>
  </template>
}
