import {
  CardDef,
  contains,
  linksTo,
  StringField,
  field,
  linksToMany,
  containsMany,
  FieldDef,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import DateField from 'https://cardstack.com/base/date';
import GlimmerComponent from '@glimmer/component';
import SummaryCard from '../components/summary-card';
import SummaryGridContainer from '../components/summary-grid-container';
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
import { PercentageField } from '../percentage';
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
import { AmountWithCurrency as AmountWithCurrencyField } from '../fields/amount-with-currency';
import BooleanField from 'https://cardstack.com/base/boolean';
import { getCards } from '@cardstack/runtime-common';
import { Query } from '@cardstack/runtime-common/query';
import { Company } from './company';

interface DealSizeSummary {
  summary: string;
  percentDiff: number;
  positive: boolean;
}

class IsolatedTemplate extends Component<typeof Deal> {
  get logoURL() {
    //We default to account thumbnail
    return (
      this.args.model.thumbnailURL ?? this.args.model.account?.thumbnailURL
    );
  }
  get primaryContactName() {
    return this.args.model.account?.primaryContact?.name;
  }

  get hasCompanyInfo() {
    return (
      this.args.model?.account?.website ||
      this.args.model?.account?.headquartersAddress
    );
  }

  get hasValueBreakdown() {
    return (
      this.args.model.valueBreakdown &&
      this.args.model.valueBreakdown.length > 0
    );
  }

  get hasStakeholders() {
    return (
      this.args.model.primaryStakeholder ||
      (this.args.model.stakeholders?.length ?? 0) > 0 //stakeholders is a proxy array
    );
  }

  get realmURL(): URL {
    return this.args.model[realmURL]!;
  }

  get realmHrefs() {
    return [this.realmURL?.href];
  }

  get dealQuery(): Query {
    return {
      filter: {
        type: {
          module: new URL('./crm/deal', import.meta.url).href,
          name: 'Deal',
        },
      },
    };
  }

  query = getCards(this.dealQuery, this.realmHrefs, {
    isLive: true,
  });

  @action dealSizeSummary(deals: CardDef[]): DealSizeSummary | null {
    //currently only assumes everything works in USD
    let nonZeroDeals = (deals as Deal[]).filter(
      (deal) => deal.computedValue.amount && deal.computedValue.amount > 0,
    );
    let totalDealRevenue = nonZeroDeals.reduce(
      (acc, deal: Deal) => acc + deal.computedValue.amount,
      0,
    );
    let avgDealSize = totalDealRevenue / nonZeroDeals.length;

    if (this.args.model.computedValue?.amount) {
      let percentDiff =
        (this.args.model.computedValue?.amount - avgDealSize) / avgDealSize;
      let positive = percentDiff >= 0 ? true : false;
      let summary = `${percentDiff.toFixed(2)}% ${
        positive ? 'above' : 'below'
      } the average deal size.`;
      return {
        percentDiff,
        summary,
        positive,
      };
    }
    return null;
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
        <AccountHeader @logoURL={{this.logoURL}} @name={{@model.name}}>
          <:name>
            {{#if @model.name}}
              <h1 class='account-name'>{{@model.name}}</h1>
            {{else}}
              <h1 class='account-name default-value'>Missing Deal Name</h1>
            {{/if}}
          </:name>
          <:content>
            <div class='description content-container'>
              <div class='info-container'>
                <@fields.company
                  @format='atom'
                  @displayContainer={{false}}
                  class='info-atom'
                />
                <@fields.primaryContact
                  @format='atom'
                  @displayContainer={{false}}
                  class='info-atom'
                />
              </div>
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
                {{#if this.query.isLoading}}
                  Loading...
                {{else if this.query.instances}}
                  {{#let
                    (this.dealSizeSummary this.query.instances)
                    as |dealSizeSummary|
                  }}
                    <p
                      class='description
                        {{if
                          dealSizeSummary.positive
                          "success-value"
                          "danger-value"
                        }}'
                    >
                      {{dealSizeSummary.summary}}
                    </p>
                  {{/let}}
                {{/if}}

              </div>
              <div class='block'>
                <label>Predicted Revenue:</label>
                {{! TODO: compound fields have divs that wrap them. Seems a bit inconsistent.}}
                <div class='highlight-value'>
                  {{#if @model.predictedRevenue.amount}}
                    <@fields.predictedRevenue
                      class='highlight-value'
                      @format='atom'
                    />
                  {{else}}
                    <div class='default-value'>
                      N/A
                    </div>
                  {{/if}}
                </div>
                <p class='description secondary-value'>Based on similar events</p>
              </div>
              <div class='block'>
                <label>Profit Margin:</label>
                {{! TODO: compound fields have divs that wrap them. Seems a bit inconsistent.}}
                <div class='highlight-value'>
                  {{#if @model.profitMargin}}
                    <@fields.profitMargin @format='atom' />
                  {{else}}
                    <div class='default-value'>
                      N/A
                    </div>
                  {{/if}}
                </div>
                <p class='description secondary-value'>Estimated</p>
              </div>
            </article>

            <hr />

            {{#if this.hasValueBreakdown}}
              <article class='value-breakdown'>
                <header>
                  <label>Value Breakdown</label>
                </header>
                <div class='breakdown-table'>
                  <@fields.valueBreakdown />
                </div>
              </article>

              <hr />
            {{/if}}

            <footer class='next-steps'>
              <div class='next-steps-row'>
                <EntityDisplay @center={{true}}>
                  <:title>
                    Notes
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
                    View Attachment
                  </BoxelButton>
                {{/if}}
              </div>
              <div class='description content-container'>
                {{#if @model.notes}}
                  <@fields.notes />
                {{else}}
                  <div class='default-value'>
                    No Notes
                  </div>
                {{/if}}
              </div>
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
                  <div class='default-value'>
                    Missing Company Info
                  </div>
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
                {{else}}
                  <div class='default-value'>
                    No Stakeholders
                  </div>
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
      .danger-value {
        font: 300 var(--boxel-font-sm);
        color: var(--boxel-orange);
      }
      .default-value {
        color: var(--boxel-400);
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
      .tag-container,
      .info-container {
        display: flex;
        flex-wrap: wrap;
        align-items: start;
        gap: var(--boxel-sp-xxs);
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
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .content-container {
        margin: 0;
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
      /* footer */
      .next-steps {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
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
      .info-atom {
        width: fit-content;
        display: inline-block;
      }
      .header-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        flex-shrink: 0;
        margin-left: auto;
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof Deal> {
  get logoURL() {
    return (
      this.args.model.thumbnailURL ?? this.args.model.account?.thumbnailURL
    );
  }

  get primaryContactName() {
    return this.args.model.account?.primaryContact?.name;
  }

  get hasCompanyInfo() {
    return (
      this.args.model?.account?.website ||
      this.args.model?.account?.headquartersAddress
    );
  }

  get hasValueBreakdown() {
    return (
      this.args.model.valueBreakdown &&
      this.args.model.valueBreakdown.length > 0
    );
  }

  get hasStakeholders() {
    return (
      this.args.model.primaryStakeholder ||
      (this.args.model.stakeholders?.length ?? 0) > 0
    );
  }

  <template>
    <article class='fitted-deal-card'>
      <header class='deal-header'>
        <AccountHeader
          @logoURL={{this.logoURL}}
          @name={{@model.name}}
          class='crm-account-header'
        >
          <:name>
            {{#if @model.name}}
              <h1 class='account-name'>{{@model.name}}</h1>
            {{else}}
              <h1 class='account-name default-value'>Missing Deal Name</h1>
            {{/if}}
          </:name>
          <:content>
            <div class='account-info'>
              <@fields.company
                @format='atom'
                @displayContainer={{false}}
                class='info-atom'
              />
              <@fields.primaryContact
                @format='atom'
                @displayContainer={{false}}
                class='info-atom'
              />
            </div>
          </:content>
        </AccountHeader>

        <div class='deal-status'>
          {{@model.status.label}}
        </div>
      </header>

      <div class='deal-content'>
        <div class='deal-details'>
          <div class='deal-field'>
            <label>Current Value:</label>
            <@fields.computedValue class='highlight-value' @format='atom' />
          </div>

          <div class='deal-field'>
            <label>Close Date</label>
            <div class='highlight-value'>
              <@fields.closeDate @format='atom' />
            </div>
          </div>

          {{#if @model.healthScore}}
            <div class='deal-field'>
              <label>Health Score</label>
              <div class='progress-container'>
                <CrmProgressBar
                  @value={{@model.healthScore}}
                  @max={{100}}
                  @color='var(--boxel-green)'
                />
                <div class='highlight-value'>
                  {{@model.healthScore}}
                </div>
              </div>
            </div>
          {{/if}}
        </div>

        <div class='event-details'>
          {{! just serve the placeholder for grid system ,pending event card - https://linear.app/cardstack/issue/CS-7691/add-event-card }}
        </div>
      </div>

    </article>

    <style scoped>
      h1,
      p {
        margin: 0;
      }
      label {
        color: var(--boxel-500);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .default-value {
        color: var(--boxel-400);
      }
      .fitted-deal-card {
        display: grid;
        width: 100%;
        height: 100%;
        grid-template-areas:
          'deal-header'
          'deal-content';
        grid-template-rows: max-content auto;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
      }
      .deal-header {
        grid-area: deal-header;
        display: grid;
        grid-template-areas: 'crm-account-header deal-status';
        grid-template-columns: 75% auto;
        align-items: start;
        gap: var(--boxel-sp-lg);
      }
      .deal-content {
        grid-area: deal-content;
        display: grid;
        grid-template-areas: 'deal-details event-details';
        grid-template-columns: 1fr 1fr;
        align-items: center;
        gap: var(--boxel-sp-lg);
        margin-top: auto;
      }
      .crm-account-header {
        grid-area: crm-account-header;
        overflow: hidden;
      }
      .deal-status {
        grid-area: deal-status;
        margin-left: auto;
      }
      .account-name {
        font-size: var(--boxel-font-size-med);
        font-weight: 600;
      }
      .account-info {
        display: flex;
        align-items: start;
        gap: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .account-name,
      .account-info:deep(.entity-name) {
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 1;
        width: 100%;
      }
      .info-atom {
        width: fit-content;
        display: inline-block;
      }
      /* deal details */
      .deal-details {
        grid-area: deal-details;
        display: flex;
        gap: var(--boxel-sp-lg);
      }
      .deal-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }
      .highlight-value {
        font-weight: 600;
        font-size: calc(var(--boxel-font-size) - 1px);
      }
      .progress-container {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }
      .event-details {
        grid-area: event-details;
        background-color: var(--boxel-300);
      }
      /* Catch all because deal is too dense*/
      @container fitted-card (height < 180px) {
        .fitted-deal-card {
          grid-template-areas: 'deal-header';
          grid-template-rows: auto;
          padding: var(--boxel-sp-sm);
        }
        .deal-content {
          display: none;
        }

        .deal-header {
          grid-area: deal-header;
          display: grid;
          grid-template-areas: 'crm-account-header';
          grid-template-columns: 1fr;
          align-items: start;
          gap: var(--boxel-sp-lg);
        }
        .deal-status {
          display: none;
        }

        .deal-header:deep(.account-header-logo) {
          width: 40px;
          height: 40px;
        }
        .account-name {
          font-size: var(--boxel-font-size-sm);
        }
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
      label: 'Low Priority',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: '#E3F2FD',
      },
    },
    {
      index: 1,
      label: 'Medium Priority',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: '#FFF0B3',
      },
    },
    {
      index: 2,
      label: 'High Priority',
      colorScheme: {
        foregroundColor: '#000000',
        backgroundColor: 'var(--boxel-yellow)',
      },
    },
  ];
}

export class ValueLineItem extends FieldDef {
  static displayName = 'CRM Value Line Item';
  @field name = contains(StringField);
  @field value = contains(AmountWithCurrencyField);

  static embedded = class Embedded extends Component<typeof ValueLineItem> {
    <template>
      <div class='line-item'>
        <div class='description'>{{@model.name}}</div>
        <div class='amount'>
          <@fields.value class='amount' @format='atom' />
        </div>
      </div>

      <style scoped>
        .line-item {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs);
        }

        .description {
          word-wrap: break-word;
          min-width: 0;
        }

        .amount {
          text-align: right;
          font-weight: 600;
        }
      </style>
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
  @field currentValue = contains(AmountWithCurrencyField);
  @field computedValue = contains(AmountWithCurrencyField, {
    computeVia: function (this: Deal) {
      let total =
        this.currentValue?.amount ??
        this.valueBreakdown?.reduce((acc, item) => {
          return acc + item.value.amount;
        }, 0);
      let result = new AmountWithCurrencyField();
      result.amount = total;
      result.currency = this.currentValue?.currency;
      return result;
    },
  });
  @field predictedRevenue = contains(AmountWithCurrencyField);
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
  @field valueBreakdown = containsMany(ValueLineItem);
  @field isActive = contains(BooleanField, {
    computeVia: function (this: Deal) {
      return (
        this.status.label === 'Closed Won' ||
        this.status.label === 'Closed Lost'
      );
    },
  });
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
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field primaryContact = linksTo(Contact, {
    computeVia: function (this: Deal) {
      return this.account?.primaryContact;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field company = linksTo(Company, {
    computeVia: function (this: Deal) {
      return this.account?.company;
    },
  });
  static isolated = IsolatedTemplate;
  static fitted = FittedTemplate;
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
