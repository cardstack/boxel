// TODO: please organize imports
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
import { Pill, BoxelButton } from '@cardstack/boxel-ui/components';
import { cn, not } from '@cardstack/boxel-ui/helpers';
import Info from '@cardstack/boxel-icons/info';
import AccountHeader from '../components/account-header';
import CrmProgressBar from '../components/crm-progress-bar';
import EntityDisplayWithIcon from '../components/entity-icon-display';
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
import FilterSearch from '@cardstack/boxel-icons/filter-search';
import FilePen from '@cardstack/boxel-icons/file-pen';
import ArrowLeftRight from '@cardstack/boxel-icons/arrow-left-right';
import Award from '@cardstack/boxel-icons/award';
import AwardOff from '@cardstack/boxel-icons/award-off';
import { AmountWithCurrency as AmountWithCurrencyField } from '../fields/amount-with-currency';
import BooleanField from 'https://cardstack.com/base/boolean';
import { getCards } from '@cardstack/runtime-common';
import { Query } from '@cardstack/runtime-common/query';
import { Company } from './company';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import { restartableTask } from 'ember-concurrency';
import { on } from '@ember/modifier';

interface DealSizeSummary {
  summary: string;
  percentDiff: number;
  positive: boolean;
}

const taskSource = {
  module: new URL('./task', import.meta.url).href,
  name: 'CRMTask',
};

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

  get dealId() {
    return this.args.model.id;
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

  get activeTasksQuery(): Query {
    let everyArr = [];
    if (this.dealId) {
      everyArr.push({
        eq: {
          'deal.id': this.dealId,
        },
      });
    }
    return {
      filter: {
        on: taskSource,
        every: everyArr,
      },
    };
  }

  query = getCards(this.dealQuery, this.realmHrefs, {
    isLive: true,
  });

  activeTasks = getCards(this.activeTasksQuery, this.realmHrefs, {
    isLive: true,
  });

  private _createNewTask = restartableTask(async () => {
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          name: null,
          details: null,
          status: {
            index: 1,
            label: 'In Progress',
          },
          priority: {
            index: null,
            label: null,
          },
          description: null,
          thumbnailURL: null,
        },
        relationships: {
          assignee: {
            links: {
              self: null,
            },
          },
          deal: {
            links: {
              self: this.dealId ?? null,
            },
          },
        },
        meta: {
          adoptsFrom: taskSource,
        },
      },
    };

    await this.args.context?.actions?.createCard?.(
      taskSource,
      new URL(taskSource.module),
      {
        realmURL: this.realmURL,
        doc,
      },
    );
  });

  createNewTask = () => {
    this._createNewTask.perform();
  };

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

  <template>
    <DealPageLayout>
      <:header>
        <div class='page-header'>
          <AccountHeader @logoURL={{this.logoURL}} @name={{@model.name}}>
            <:name>
              <h1 class={{cn 'account-name' default-value=(not @model.name)}}>
                {{#if @model.title}}<@fields.title />{{else}}Missing Deal Name{{/if}}
              </h1>
            </:name>
            <:content>
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
            </:content>
          </AccountHeader>
          <ul class='tags'>
            {{#if @model.status}}
              <Pill
                class='tag'
                @tag='li'
                @pillBackgroundColor={{@model.status.colorScheme.backgroundColor}}
              >
                {{@model.status.label}}
              </Pill>
            {{/if}}
            {{#if @model.priority}}
              <Pill
                class='tag'
                @tag='li'
                @pillBackgroundColor={{@model.priority.colorScheme.backgroundColor}}
              >
                {{@model.priority.label}}
              </Pill>
            {{/if}}
          </ul>
        </div>
      </:header>

      <:dashboard>
        <SummaryCard class='dashboard'>
          <:title>
            <h2 class='summary-title'>Deal Value</h2>
          </:title>
          <:icon>
            {{#if @model.healthScore}}
              <div class='progress-container'>
                <span class='progress-label'>
                  {{@model.healthScore}}% Health Score
                </span>
                <CrmProgressBar
                  @value={{@model.healthScore}}
                  @max={{100}}
                  @color='var(--boxel-green)'
                />
              </div>
            {{/if}}
          </:icon>
          <:content>
            <div class='dashboard-cards'>
              <div class='block'>
                Current Value
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
                Predicted Revenue
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
                <span class='description'>
                  Based on similar events
                </span>
              </div>
              <div class='block'>
                Profit Margin
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
                <span class='description'>
                  Estimated
                </span>
              </div>
            </div>

            <hr />

            {{#if this.hasValueBreakdown}}
              <div class='value-breakdown'>
                <header>
                  <h4 class='breakdown-title'>Value Breakdown</h4>
                </header>
                <div class='breakdown-table'>
                  <@fields.valueBreakdown />
                </div>
              </div>

              <hr />
            {{/if}}

            <footer class='next-steps'>
              <div class='next-steps-row'>
                <EntityDisplayWithIcon @title='Notes' @center={{true}}>
                  <:icon>
                    <Info class='info-icon' />
                  </:icon>
                </EntityDisplayWithIcon>
              </div>
              <div class='content-container'>
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
          <SummaryCard class='info-card'>
            <:title>
              <h3 class='info-card-title'>Company Info</h3>
            </:title>
            <:icon>
              <World class='header-icon' />
            </:icon>
            <:content>
              {{#if this.hasCompanyInfo}}
                <@fields.headquartersAddress @format='atom' />
                <@fields.website @format='atom' />
              {{else}}
                <div class='default-value'>
                  Missing Company Info
                </div>
              {{/if}}
            </:content>
          </SummaryCard>

          <SummaryCard class='info-card'>
            <:title>
              <h3 class='info-card-title'>Stakeholders</h3>
            </:title>
            <:icon>
              <Users class='header-icon' />
            </:icon>
            <:content>
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
            </:content>
          </SummaryCard>

          <SummaryCard class='info-card'>
            <:title>
              <h3 class='info-card-title'>Active Tasks</h3>
            </:title>
            <:icon>
              <BoxelButton
                class='new-item-button'
                @kind='primary'
                @size='extra-small'
                @disabled={{this.activeTasks.isLoading}}
                @loading={{this._createNewTask.isRunning}}
                {{on 'click' this.createNewTask}}
              >
                New Task
              </BoxelButton>
            </:icon>
            <:content>
              {{#if this.activeTasks.isLoading}}
                Loading...
              {{else if this.activeTasks.instances}}
                {{this.activeTasks.instances.length}}
              {{else}}
                <div class='default-value'>
                  No Active Tasks
                </div>
              {{/if}}
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
        border: 0.5px solid var(--boxel-200);
        margin: var(--boxel-sp) 0;
      }
      .page-header {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--boxel-sp-lg);
      }
      .highlight-value {
        font: 600 var(--boxel-font-xl);
        white-space: nowrap;
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
        gap: var(--boxel-sp-4xs);
      }
      .dashboard {
        --summary-card-padding: var(--boxel-sp);
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
        letter-spacing: var(--boxel-lsp-xxs);
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
      .tags,
      .info-container {
        margin: 0;
        padding: 0;
        list-style-type: none;
        display: flex;
        flex-wrap: wrap;
        align-items: start;
        gap: var(--boxel-sp-xs);
      }
      .tag {
        --pill-border: none;
        --pill-font: 600 var(--boxel-font-xs);
        --pill-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
      }
      .info-container {
        gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
      }
      .info-field {
        --entity-display-title-font-weight: 400;
      }
      .summary-title,
      .info-card-title {
        font: 600 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xxs);
        align-self: flex-start;
      }
      .summary-highlight {
        font: 600 var(--boxel-font-lg);
      }
      .description {
        color: var(--boxel-450);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
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
        gap: var(--boxel-sp-xs);
      }
      .progress-label {
        font: var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .breakdown-title {
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
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
        display: inline-flex;
      }
      .header-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        flex-shrink: 0;
        margin-left: auto;
      }
      .info-card {
        --summary-card-gap: var(--boxel-sp-xl);
        --summary-card-padding: var(--boxel-sp);
        --entity-display-title-font-weight: 400;
      }
      .new-item-button {
        font-weight: 600;
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
          <@fields.status @format='atom' @displayContainer={{false}} />
        </div>
      </header>

      <div class='account-info account-info-grid-view'>
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

      <div class='deal-content'>
        <div class='deal-details'>
          <div class='deal-field'>
            <span class='label'>Current Value</span>
            <@fields.computedValue class='highlight-value' @format='atom' />
          </div>

          <div class='deal-field'>
            <span class='label'>Close Date</span>
            <div class='highlight-value'>
              <@fields.closeDate @format='atom' />
            </div>
          </div>

          {{#if @model.healthScore}}
            <div class='deal-field'>
              <span class='label'>Health Score</span>
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
      .label {
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
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
        grid-area: account-name;
        font: 600 var(--boxel-font-sm);
      }
      .account-info {
        display: flex;
        align-items: start;
        gap: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .account-info-grid-view {
        display: none;
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
        display: inline-flex;
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
      .deal-header:deep(.account-header-logo) {
        grid-area: account-header-logo;
      }
      /* Catch all because deal is too dense*/
      @container fitted-card (height < 180px) {
        .fitted-deal-card {
          grid-template-areas: 'deal-header';
          grid-template-rows: auto;
          padding: var(--boxel-sp-sm);
        }
        .crm-account-header {
          --account-header-logo-size: 40px;
        }
        .deal-content {
          display: none;
        }
        .deal-header {
          grid-area: deal-header;
          display: grid;
          grid-template-areas: 'crm-account-header';
          grid-template-columns: 100%;
          align-items: start;
          gap: var(--boxel-sp-lg);
        }
        .deal-status {
          display: none;
        }
        .account-name {
          font-size: var(--boxel-font-size-sm);
        }
      }

      @container fitted-card (aspect-ratio <= 2.0) {
        .fitted-deal-card {
          display: grid;
          width: 100%;
          height: 100%;
          grid-template-areas:
            'deal-header'
            'grid-account-info'
            'deal-content';
          grid-template-rows: max-content max-content auto;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
        }
        .crm-account-header {
          --account-header-logo-size: 40px;
        }
        .account-name {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 3;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .account-info {
          display: none;
        }
        .info-atom {
          --entity-display-icon-size: var(--boxel-icon-sm);
          --entity-display-title-font-size: var(--boxel-font-size-xs);
        }
        .account-info-grid-view {
          display: flex;
          flex-direction: column;
        }
        .deal-header {
          grid-template-columns: auto;
          gap: 0;
        }
        .deal-status {
          display: none;
        }
        .deal-content {
          grid-template-columns: 1fr;
          gap: 0;
        }
        .deal-details {
          display: grid;
          grid-template-rows: auto auto;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-xs);
        }
        .deal-field {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs);
        }
        /* Make the first two fields appear in row 1 */
        .deal-field:nth-child(1),
        .deal-field:nth-child(2) {
          grid-row: 1;
        }
        /* Make the health score field take full width in row 2 */
        .deal-field:nth-child(3) {
          grid-row: 2;
          grid-column: 1 / -1;
        }
        .highlight-value {
          font: 600 var(--boxel-font-xs);
        }
        .progress-bar {
          width: 100%;
        }
      }
    </style>
  </template>
}

export const dealStatusValues = [
  {
    index: 0,
    icon: FilterSearch,
    label: 'Discovery',
    value: 'discovery',
    buttonText: 'Create Deal', // TODO: For the createNewButtonText usage in CRM App
    colorScheme: {
      foregroundColor: '#D32F2F', // Dark Red
      backgroundColor: '#FFEBEE', // Light Red
    },
  },
  {
    index: 1,
    icon: FilePen,
    label: 'Proposal',
    value: 'proposal',
    buttonText: 'Create Deal',
    colorScheme: {
      foregroundColor: '#000000',
      backgroundColor: 'var(--boxel-lilac)',
    },
  },
  {
    index: 2,
    icon: ArrowLeftRight,
    label: 'Negotiation',
    value: 'negotiation',
    buttonText: 'Create Deal',
    colorScheme: {
      foregroundColor: '#000000',
      backgroundColor: '#FFF3E0', // light orange
    },
  },
  {
    index: 3,
    icon: Award,
    label: 'Closed Won',
    value: 'closed-won',
    buttonText: 'Create Deal',
    colorScheme: {
      foregroundColor: '#000000',
      backgroundColor: '#E8F5E9', // light green
    },
  },
  {
    index: 4,
    icon: AwardOff,
    label: 'Closed Lost',
    value: 'closed-lost',
    buttonText: 'Create Deal',
    colorScheme: {
      foregroundColor: '#000000',
      backgroundColor: '#FFEBEE', // light red
    },
  },
];

class DealStatus extends LooseGooseyField {
  static displayName = 'CRM Deal Status';
  static values = dealStatusValues;

  static atom = class Atom extends Component<typeof this> {
    get statusData() {
      return dealStatusValues.find(
        (status) => status.label === this.args.model.label,
      );
    }

    <template>
      {{#if @model.label}}
        <EntityDisplayWithIcon @title={{@model.label}}>
          <:icon>
            {{this.statusData.icon}}
          </:icon>
        </EntityDisplayWithIcon>
      {{/if}}
    </template>
  };
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
  static headerColor = '#f8f7fa';
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
  @field primaryStakeholder = linksTo(() => Contact);
  @field stakeholders = linksToMany(() => Contact);
  @field valueBreakdown = containsMany(ValueLineItem);
  @field isActive = contains(BooleanField, {
    computeVia: function (this: Deal) {
      return (
        this.status.label !== 'Closed Won' &&
        this.status.label !== 'Closed Lost'
      );
    },
    isUsed: true,
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
  @field title = contains(StringField, {
    computeVia: function (this: Deal) {
      return this.name;
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
        padding: var(--boxel-sp-xl);
        box-sizing: border-box;
        background-color: var(--boxel-100);
      }
    </style>
  </template>
}
