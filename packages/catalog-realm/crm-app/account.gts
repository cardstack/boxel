import {
  CardDef,
  BaseDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
  realmURL,
  StringField,
} from 'https://cardstack.com/base/card-api';
import WebsiteField from 'https://cardstack.com/base/website';
import AddressField from 'https://cardstack.com/base/address';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import { Query } from '@cardstack/runtime-common';
import { restartableTask } from 'ember-concurrency';

import { Company } from './company';
import { Contact } from './contact';
import { CrmApp } from './crm-app';
import { Deal } from './deal';
import { StatusTagField } from './contact-status-tag';
import { UrgencyTag } from './urgency-tag';

import AccountHeader from './components/account-header';
import PageLayout from './components/page-layout';
import SummaryCard from './components/summary-card';
import SummaryGridContainer from './components/summary-grid-container';

import {
  BoxelButton,
  FieldContainer,
  Pill,
  SkeletonPlaceholder,
} from '@cardstack/boxel-ui/components';
import { cn, not } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';

import AccountIcon from '@cardstack/boxel-icons/building';
import ChartBarPopular from '@cardstack/boxel-icons/chart-bar-popular';
import ContactIcon from '@cardstack/boxel-icons/contact';
import PlusIcon from '@cardstack/boxel-icons/plus';
import TrendingUp from '@cardstack/boxel-icons/trending-up';

const taskSource = {
  module: new URL('./task', import.meta.url).href,
  name: 'CRMTask',
};

class EditTemplate extends Component<typeof Account> {
  <template>
    <div class='account-form'>
      <FieldContainer @label='Company'>
        <@fields.company />
      </FieldContainer>
      <FieldContainer @label='Primary Contact'>
        <@fields.primaryContact />
      </FieldContainer>
      <FieldContainer @label='Contacts'>
        <@fields.contacts />
      </FieldContainer>
      <FieldContainer @label='Shipping Address'>
        <@fields.shippingAddress />
      </FieldContainer>
      <FieldContainer @label='Billing Address'>
        <@fields.billingAddress />
      </FieldContainer>
      <FieldContainer @label='Urgency Tag'>
        <@fields.urgencyTag />
      </FieldContainer>
      <FieldContainer @label='CRM App'>
        <@fields.crmApp />
      </FieldContainer>
      <FieldContainer @label='Logo URL'>
        <@fields.thumbnailURL />
      </FieldContainer>
    </div>
    <style scoped>
      .account-form {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

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

  get realmURL(): URL {
    return this.args.model[realmURL]!;
  }

  get realmHrefs() {
    return [this.realmURL?.href];
  }

  get accountId() {
    return this.args.model.id;
  }

  // Query All Active Deal that linked to current Account
  get dealQuery(): Query {
    return {
      filter: {
        on: {
          module: new URL('./deal', import.meta.url).href,
          name: 'Deal',
        },
        every: [
          { eq: { 'account.id': this.args.model.id ?? '' } },
          { eq: { isActive: true } },
        ],
      },
    };
  }

  get activeTasksQuery(): Query {
    let everyArr = [];
    if (this.accountId) {
      everyArr.push({
        eq: {
          'account.id': this.accountId,
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

  deals = this.args.context?.getCards(
    this,
    () => this.dealQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  activeTasks = this.args.context?.getCards(
    this,
    () => this.activeTasksQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

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
          account: {
            links: {
              self: this.accountId ?? null,
            },
          },
        },
        meta: {
          adoptsFrom: taskSource,
        },
      },
    };

    await this.args.createCard?.(taskSource, new URL(taskSource.module), {
      realmURL: this.realmURL,
      doc,
    });
  });

  createNewTask = () => {
    this._createNewTask.perform();
  };

  get activeTasksCount() {
    const tasks = this.activeTasks;
    if (!tasks || tasks.isLoading) {
      return 0;
    }
    return tasks.instances?.length ?? 0;
  }

  get hasActiveTasks() {
    return this.activeTasksCount > 0;
  }

  get activeDealsCount() {
    const deals = this.deals;
    if (!deals || deals.isLoading) {
      return 0;
    }
    return deals.instances?.length ?? 0;
  }

  get totalDealsValue() {
    const deals = this.deals;
    if (!deals || deals.isLoading) {
      return 'No deals';
    }

    if (!deals.instances?.length) {
      return 'No active deals';
    }

    const dealsInstances = deals.instances as Deal[];

    const total = dealsInstances.reduce((sum, deal) => {
      const value = deal?.computedValue?.amount ?? 0;
      return sum + value;
    }, 0);

    const firstDeal = dealsInstances[0] as Deal;
    const currencySymbol = firstDeal.computedValue?.currency?.symbol;

    if (!total) {
      return 'No deal value';
    }

    // Format total with 1 decimal place
    const formattedTotal = (total / 1000).toLocaleString('en-US', {
      minimumFractionDigits: 2,
    });
    return currencySymbol
      ? `${currencySymbol}${formattedTotal}k total value`
      : `${formattedTotal}k total value`;
  }

  // Query All lifetime Value from Closed Won Deal
  get lifetimeValueQuery(): Query {
    return {
      filter: {
        on: {
          module: new URL('./deal', import.meta.url).href,
          name: 'Deal',
        },
        every: [
          { eq: { 'account.id': this.args.model.id ?? '' } },
          { eq: { 'status.label': 'Closed Won' } },
        ],
      },
    };
  }

  lifetimeValueDeals = this.args.context?.getCards(
    this,
    () => this.lifetimeValueQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  get lifetimeMetrics() {
    if (!this.lifetimeValueDeals) {
      return { total: 0, currentYear: 0, lastYear: 0, growth: 0 };
    }

    if (
      this.lifetimeValueDeals.isLoading ||
      !this.lifetimeValueDeals.instances
    ) {
      return { total: 0, currentYear: 0, lastYear: 0, growth: 0 };
    }

    const currentYear = new Date().getFullYear();
    const lifetimeValueDealsInstances = this.lifetimeValueDeals
      .instances as Deal[];

    // Calculate the Total Value of All Time
    const total = lifetimeValueDealsInstances.reduce(
      (sum, deal) => sum + (deal.computedValue?.amount ?? 0),
      0,
    );

    // Calculate the Value of This Year
    const currentYearValue = lifetimeValueDealsInstances
      .filter((deal) => new Date(deal.closeDate).getFullYear() === currentYear)
      .reduce((sum, deal) => sum + (deal.computedValue?.amount ?? 0), 0);

    // Calculate the Value of Last Year
    const lastYearValue = lifetimeValueDealsInstances
      .filter(
        (deal) => new Date(deal.closeDate).getFullYear() === currentYear - 1,
      )
      .reduce((sum, deal) => sum + (deal.computedValue?.amount ?? 0), 0);

    // Calculate growth rate
    const growth = lastYearValue
      ? ((currentYearValue - lastYearValue) / lastYearValue) * 100
      : 0;

    return {
      total,
      currentYear: currentYearValue,
      lastYear: lastYearValue,
      growth,
    };
  }

  get formattedLifetimeTotal() {
    const total = this.lifetimeMetrics.total;
    if (total === 0) {
      return '$0';
    }
    const formattedTotal = (total / 1000).toLocaleString('en-US', {
      minimumFractionDigits: 2,
    });
    return `$${formattedTotal}k`;
  }

  get formattedCurrentYearValue() {
    const currentYearValue = this.lifetimeMetrics.currentYear;
    const formattedValue =
      currentYearValue === 0
        ? '+$0'
        : `+$${(currentYearValue / 1000).toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}k`;
    const currentYear = new Date().getFullYear();
    return `${formattedValue} in ${currentYear}`;
  }

  removeFileExtension(cardUrl: string) {
    return cardUrl.replace(/\.[^/.]+$/, '');
  }

  <template>
    <PageLayout @format='isolated'>
      <:header>
        <div class='header-container'>
          <AccountHeader @logoURL={{@model.thumbnailURL}} @name={{@model.name}}>
            <:name>
              <h1 class={{cn 'account-name' default-value=(not @model.name)}}>
                {{#if @model.title}}<@fields.title />{{else}}Missing Account
                  Name{{/if}}
              </h1>
            </:name>
            <:content>
              {{#if @model.primaryContact}}
                <@fields.primaryContact
                  @format='atom'
                  @displayContainer={{false}}
                  class='info-atom'
                />
              {{/if}}
            </:content>
          </AccountHeader>
          <ul class='tag-list'>
            <li><@fields.statusTag @format='atom' /></li>
            <li><@fields.urgencyTag @format='atom' /></li>
          </ul>
        </div>
      </:header>

      <:summary>
        <SummaryGridContainer>
          <SummaryCard @iconComponent={{AccountIcon}} @title='Company Info'>
            <:content>
              {{#if this.hasCompanyInfo}}
                <@fields.website @format='atom' />
                <@fields.headquartersAddress @format='atom' />
              {{else}}
                <div class='default-value'>
                  Missing Company Info
                </div>
              {{/if}}
            </:content>
          </SummaryCard>

          <SummaryCard @iconComponent={{ContactIcon}} @title='Contacts'>
            <:content>
              {{#if this.hasContacts}}
                <div class='primary-contact-group'>
                  <@fields.primaryContact
                    @format='atom'
                    @displayContainer={{false}}
                  />
                  <Pill class='primary-tag' @pillBackgroundColor='#e8e8e8'>
                    Primary
                  </Pill>
                </div>

                <@fields.contacts @format='atom' @displayContainer={{false}} />
              {{else}}
                <div class='default-value'>
                  Missing Contacts
                </div>
              {{/if}}
            </:content>
          </SummaryCard>

          <SummaryCard
            @iconComponent={{ChartBarPopular}}
            @title='Lifetime Value'
          >
            <:content>
              {{#if this.lifetimeValueDeals.isLoading}}
                <SkeletonPlaceholder
                  class='skeleton-placeholder-deal-summary-highlight'
                />
                <SkeletonPlaceholder
                  class='skeleton-placeholder-deal-description'
                />
              {{else}}
                <h3 class='summary-highlight'>
                  {{this.formattedLifetimeTotal}}
                </h3>
                <p class='description'>
                  {{this.formattedCurrentYearValue}}
                </p>
              {{/if}}
            </:content>
          </SummaryCard>

          <SummaryCard @iconComponent={{TrendingUp}} @title='Active Deals'>
            <:content>
              {{#if this.deals.isLoading}}
                <SkeletonPlaceholder
                  class='skeleton-placeholder-deal-summary-highlight'
                />
                <SkeletonPlaceholder
                  class='skeleton-placeholder-deal-description'
                />
              {{else}}
                <h3 class='summary-highlight'>{{this.activeDealsCount}}</h3>
                <p class='description'>{{this.totalDealsValue}}</p>
              {{/if}}
            </:content>
          </SummaryCard>
        </SummaryGridContainer>
      </:summary>

      <:content>
        <SummaryCard class='tasks-summary-card'>
          <:title>
            <h3 class='upcoming-tasks-title'>Upcoming Tasks</h3>
          </:title>
          <:icon>
            <BoxelButton
              @kind='primary'
              class='task-button-mobile'
              data-test-settings-button
              @disabled={{this.activeTasks.isLoading}}
              @loading={{this._createNewTask.isRunning}}
              {{on 'click' this.createNewTask}}
            >
              {{#if (not this._createNewTask.isRunning)}}
                <PlusIcon />
              {{/if}}
            </BoxelButton>
            <BoxelButton
              @kind='primary'
              @size='base'
              class='task-button-desktop'
              @disabled={{this.activeTasks.isLoading}}
              @loading={{this._createNewTask.isRunning}}
              data-test-settings-button
              {{on 'click' this.createNewTask}}
            >
              {{#if (not this._createNewTask.isRunning)}}
                <PlusIcon />
              {{/if}}
              New Task
            </BoxelButton>
          </:icon>
          <:content>
            {{#if this.activeTasks.isLoading}}
              <SkeletonPlaceholder class='skeleton-placeholder-task' />
            {{else}}
              {{#if this.hasActiveTasks}}
                {{#each this.activeTasks.instances as |task|}}
                  {{#let (getComponent task) as |Component|}}
                    <div
                      {{@context.cardComponentModifier
                        cardId=task.id
                        format='data'
                        fieldType=undefined
                        fieldName=undefined
                      }}
                      data-test-cards-grid-item={{this.removeFileExtension
                        task.id
                      }}
                      data-cards-grid-item={{this.removeFileExtension task.id}}
                    >
                      <Component
                        @format='embedded'
                        @displayContainer={{false}}
                      />
                    </div>
                  {{/let}}
                {{/each}}
              {{else}}
                <p class='description'>No Upcoming Tasks</p>
              {{/if}}
            {{/if}}
          </:content>
        </SummaryCard>
      </:content>
    </PageLayout>

    <style scoped>
      h1,
      h2,
      h3,
      p {
        margin-block: 0;
      }
      .header-container {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--boxel-sp-lg);
      }
      .account-name {
        font: 600 var(--boxel-font-lg);
        margin: 0;
      }
      /* Summary Grid & Card */
      .summary-highlight {
        font: 600 var(--boxel-font-xl);
      }
      .description {
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .info-card {
        --summary-card-gap: var(--boxel-sp-xl);
        --summary-card-padding: var(--boxel-sp);
        --entity-display-title-font-weight: 400;
      }
      .primary-contact-group {
        --entity-display-thumbnail-size: var(--boxel-icon-sm);
        display: inline-flex;
        align-items: start;
        gap: var(--boxel-sp-xs);
      }
      .primary-tag {
        --pill-font-weight: 400;
        --pill-padding: var(--boxel-sp-6xs) var(--boxel-sp-xxs);
        --pill-font: 400 var(--boxel-font-xs);
        --pill-border: none;
        flex-shrink: 0;
      }
      .tag-list {
        margin: 0;
        padding: 0;
        list-style-type: none;
        display: flex;
        flex-wrap: wrap;
        align-items: start;
        gap: var(--boxel-sp-xs);
      }
      .default-value {
        color: var(--boxel-400);
      }
      /* Task */
      .task-button-mobile {
        display: none;
      }
      .task-button-desktop {
        display: inline-flex;
        gap: var(--boxel-sp-xxxs);
      }
      .tasks-summary-card {
        --summary-card-padding: var(--boxel-sp-lg) var(--boxel-sp);
        --summary-card-content-gap: 0;
        container-type: inline-size;
        container-name: tasks-summary-card;
      }
      .upcoming-tasks-title {
        font: 600 var(--boxel-font-md);
        letter-spacing: var(--boxel-lsp-xxs);
      }
      .tasks-summary-card :deep(.task-card) {
        --task-card-padding: var(--boxel-sp) var(--boxel-sp) var(--boxel-sp)
          var(--boxel-sp-xs);
        border-top: 1px solid var(--boxel-200);
      }
      .task-title {
        font: 600 var(--boxel-font-md);
        letter-spacing: var(--boxel-lsp-xxs);
        margin: 0;
      }
      .task-pill {
        --pill-background-color: var(--boxel-200);
      }
      .task-card-group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp);
      }
      .task-time {
        font-size: var(--boxel-font-xs);
        color: var(--boxel-color-gray);
        margin-left: auto;
      }
      /* Skeleton Placeholder */
      .skeleton-placeholder-deal-summary-highlight {
        --skeleton-width: 50%;
        --skeleton-height: 22px;
      }
      .skeleton-placeholder-deal-description {
        --skeleton-height: 13px;
      }
      .skeleton-placeholder-task {
        --skeleton-height: 55px;
      }

      @container tasks-summary-card (max-width: 447px) {
        .task-button-mobile {
          display: inline-flex;
          --boxel-button-padding: 0px 0px;
          min-width: 2rem;
        }
        .task-button-desktop {
          display: none;
        }
        .task-card-group {
          flex-direction: column;
          align-items: flex-start;
        }
        .task-time {
          margin-left: 0;
        }
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof Account> {
  get realmURL(): URL {
    return this.args.model[realmURL]!;
  }

  get realmHrefs() {
    return [this.realmURL?.href];
  }

  get accountId() {
    return this.args.model.id;
  }

  // Query All Active Deal that linked to current Account
  get dealQuery(): Query {
    return {
      filter: {
        on: {
          module: new URL('./deal', import.meta.url).href,
          name: 'Deal',
        },
        every: [
          { eq: { 'account.id': this.args.model.id ?? '' } },
          { eq: { isActive: true } },
        ],
      },
    };
  }

  get activeTasksQuery(): Query {
    let everyArr = [];
    if (this.accountId) {
      everyArr.push({
        eq: {
          'account.id': this.accountId,
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

  deals = this.args.context?.getCards(
    this,
    () => this.dealQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  activeTasks = this.args.context?.getCards(
    this,
    () => this.activeTasksQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  get activeTasksCount() {
    const tasks = this.activeTasks;
    if (!tasks || tasks.isLoading) {
      return 0;
    }
    return tasks.instances?.length ?? 0;
  }

  get hasActiveTasks() {
    return this.activeTasksCount > 0;
  }

  get activeDealsCount() {
    const deals = this.deals;
    if (!deals || deals.isLoading) {
      return 0;
    }
    return deals.instances?.length ?? 0;
  }

  get totalDealsValue() {
    const deals = this.deals;
    if (!deals || deals.isLoading) {
      return 'No deals';
    }

    if (!deals.instances?.length) {
      return 'No active deals';
    }

    const dealsInstances = deals.instances as Deal[];

    const total = dealsInstances.reduce((sum, deal) => {
      const value = deal?.computedValue?.amount ?? 0;
      return sum + value;
    }, 0);

    const firstDeal = dealsInstances[0] as Deal;
    const currencySymbol = firstDeal.computedValue?.currency?.symbol;

    if (!total) {
      return 'No deal value';
    }

    const formattedTotal = (total / 1000).toLocaleString('en-US', {
      minimumFractionDigits: 2,
    });
    return currencySymbol
      ? `${currencySymbol}${formattedTotal}k total value`
      : `${formattedTotal}k total value`;
  }

  // Query All lifetime Value from Closed Won Deal
  get lifetimeValueQuery(): Query {
    return {
      filter: {
        on: {
          module: new URL('./deal', import.meta.url).href,
          name: 'Deal',
        },
        every: [
          { eq: { 'account.id': this.args.model.id ?? '' } },
          { eq: { 'status.label': 'Closed Won' } },
        ],
      },
    };
  }

  lifetimeValueDeals = this.args.context?.getCards(
    this,
    () => this.lifetimeValueQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  get lifetimeMetrics() {
    if (!this.lifetimeValueDeals) {
      return { total: 0, currentYear: 0, lastYear: 0, growth: 0 };
    }

    if (
      this.lifetimeValueDeals.isLoading ||
      !this.lifetimeValueDeals.instances
    ) {
      return { total: 0, currentYear: 0, lastYear: 0, growth: 0 };
    }

    const currentYear = new Date().getFullYear();
    const lifetimeValueDealsInstances = this.lifetimeValueDeals
      .instances as Deal[];

    // Calculate the Total Value of All Time
    const total = lifetimeValueDealsInstances.reduce(
      (sum, deal) => sum + (deal.computedValue?.amount ?? 0),
      0,
    );

    // Calculate the Value of This Year
    const currentYearValue = lifetimeValueDealsInstances
      .filter((deal) => new Date(deal.closeDate).getFullYear() === currentYear)
      .reduce((sum, deal) => sum + (deal.computedValue?.amount ?? 0), 0);

    // Calculate the Value of Last Year
    const lastYearValue = lifetimeValueDealsInstances
      .filter(
        (deal) => new Date(deal.closeDate).getFullYear() === currentYear - 1,
      )
      .reduce((sum, deal) => sum + (deal.computedValue?.amount ?? 0), 0);

    // Calculate growth rate
    const growth = lastYearValue
      ? ((currentYearValue - lastYearValue) / lastYearValue) * 100
      : 0;

    return {
      total,
      currentYear: currentYearValue,
      lastYear: lastYearValue,
      growth,
    };
  }

  get formattedLifetimeTotal() {
    const total = this.lifetimeMetrics.total;
    if (total === 0) {
      return '$0';
    }
    const formattedTotal = (total / 1000).toLocaleString('en-US', {
      minimumFractionDigits: 2,
    });
    return `$${formattedTotal}k`;
  }

  get formattedCurrentYearValue() {
    const currentYearValue = this.lifetimeMetrics.currentYear;
    const formattedValue =
      currentYearValue === 0
        ? '+$0'
        : `+$${(currentYearValue / 1000).toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}k`;
    const currentYear = new Date().getFullYear();
    return `${formattedValue} in ${currentYear}`;
  }

  <template>
    <PageLayout class='account-page-layout-embedded'>
      <:header>
        <div class='header-container'>
          <AccountHeader @logoURL={{@model.thumbnailURL}} @name={{@model.name}}>
            <:name>
              <h1 class={{cn 'account-name' default-value=(not @model.name)}}>
                {{#if @model.title}}<@fields.title />{{else}}Missing Account
                  Name{{/if}}
              </h1>
            </:name>
            <:content>
              {{#if @model.primaryContact}}
                <@fields.primaryContact
                  @format='atom'
                  @displayContainer={{false}}
                />
              {{/if}}
            </:content>
          </AccountHeader>
          <ul class='tag-list'>
            <li><@fields.statusTag @format='atom' /></li>
            <li><@fields.urgencyTag @format='atom' /></li>
          </ul>
        </div>
      </:header>
      <:summary>
        <section class='summary-articles-container'>
          <SummaryGridContainer>
            <SummaryCard
              @size='small'
              @iconComponent={{ChartBarPopular}}
              @title='Lifetime Value'
            >
              <:content>
                {{#if this.lifetimeValueDeals.isLoading}}
                  <h3 class='summary-highlight'>Loading...</h3>
                  <p class='description'>Loading...</p>
                {{else}}
                  <h3
                    class='summary-highlight'
                  >{{this.formattedLifetimeTotal}}</h3>
                  <p class='description'>
                    {{this.formattedCurrentYearValue}}
                  </p>
                {{/if}}
              </:content>
            </SummaryCard>

            <SummaryCard
              @size='small'
              @iconComponent={{TrendingUp}}
              @title='Active Deals'
            >
              <:content>
                {{#if this.deals.isLoading}}
                  <h3 class='summary-highlight'>Loading...</h3>
                  <p class='description'>Loading...</p>
                {{else}}
                  <h3 class='summary-highlight'>{{this.activeDealsCount}}</h3>
                  <p class='description'>{{this.totalDealsValue}}</p>
                {{/if}}
              </:content>
            </SummaryCard>
          </SummaryGridContainer>

          <div class='summary-articles'>
            <article>
              <label>KEY CONTACT</label>
              {{#if @model.primaryContact}}
                <@fields.primaryContact
                  @format='atom'
                  @displayContainer={{false}}
                />
              {{/if}}
            </article>

            <article>
              <label>PRIORITY TASKS</label>
              {{#if this.activeTasks.isLoading}}
                <SkeletonPlaceholder class='skeleton-placeholder-task' />
              {{else}}
                <div class='task-container'>
                  {{#if this.hasActiveTasks}}
                    {{#each this.activeTasks.instances as |task|}}
                      {{#let (getComponent task) as |Component|}}
                        <Component
                          @format='embedded'
                          @displayContainer={{false}}
                          class='task-card-embedded'
                        />
                      {{/let}}
                    {{/each}}
                  {{else}}
                    <p class='description'>No Upcoming Tasks</p>
                  {{/if}}
                </div>
              {{/if}}
            </article>
          </div>
        </section>
      </:summary>
    </PageLayout>

    <style scoped>
      h3,
      p {
        margin: 0;
      }
      .account-page-layout-embedded {
        container-type: inline-size;
        container-name: account-page-layout-embedded;
        padding: var(--boxel-sp-sm);
        height: 100%;
      }
      .header-container {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
      }
      .account-name {
        font: 600 var(--boxel-font-lg);
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .tag-list {
        margin: 0;
        padding: 0;
        list-style-type: none;
        display: flex;
        flex-wrap: wrap;
        align-items: start;
        gap: var(--boxel-sp-xs);
      }
      .summary-articles-container {
        --boxel-light-50: #fafafa;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-xxxl);
        margin-top: var(--boxel-sp-med);
        padding: var(--boxel-sp);
        border-radius: var(--boxel-border-radius-sm);
        background: var(--boxel-light-50);
        position: relative;
      }
      .summary-articles-container::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 0;
        border-left: 1px dashed var(--boxel-300);
        transform: translateX(-50%);
      }
      .summary-articles {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
      }
      article {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      /* Summary */
      .summary-highlight {
        font: 600 var(--boxel-font-lg);
        margin: 0;
      }
      .description {
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      label {
        font: 500 var(--boxel-font-sm);
        color: var(--boxel-500);
        letter-spacing: var(--boxel-lsp-xxs);
        margin: 0;
      }
      .next-steps-display {
        --entity-display-icon-size: var(--boxel-icon-sm);
        --entity-display-content-gap: var(--boxel-sp-xs);
        display: table;
        padding: var(--boxel-sp-sm);
        background: var(--boxel-light-300);
        border-radius: var(--boxel-border-radius-sm);
      }
      .primary-tag {
        --pill-font-weight: 400;
        --pill-padding: var(--boxel-sp-6xs) var(--boxel-sp-xxs);
        --pill-font: 400 var(--boxel-font-xs);
        --pill-border: none;
        flex-shrink: 0;
      }
      .task-container {
        height: 100px;
        overflow-y: auto;
      }
      .task-card-embedded {
        height: fit-content;
        background: transparent;
      }
      .task-card-embedded :where(.task-card) {
        --task-card-padding: var(--boxel-sp) 0;
        border-top: 1px solid var(--boxel-200);
      }
      /* Skeleton Placeholder */
      .skeleton-placeholder-task {
        --skeleton-height: 55px;
      }

      @container account-page-layout-embedded (max-width: 447px) {
        .header-container {
          flex-direction: column;
        }
        .summary-articles-container {
          grid-template-columns: 1fr;
          gap: var(--boxel-sp-lg);
        }
        .summary-articles-container::after {
          display: none;
        }
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof Account> {
  <template>
    <PageLayout class='account-page-layout-fitted'>
      <:header>
        <AccountHeader
          class='account-header-fitted'
          @logoURL={{@model.thumbnailURL}}
          @name={{@model.name}}
        >
          <:name>
            <h1 class={{cn 'account-name' default-value=(not @model.name)}}>
              {{#if @model.title}}<@fields.title />{{else}}Missing Account Name{{/if}}
            </h1>
          </:name>
        </AccountHeader>
      </:header>
      <:summary>
        <ul class='tag-list'>
          <li><@fields.statusTag @format='atom' /></li>
          <li><@fields.urgencyTag @format='atom' /></li>
        </ul>
      </:summary>
    </PageLayout>

    <style scoped>
      /* Base styles */
      h1,
      p {
        margin: 0;
      }
      .account-page-layout-fitted {
        height: 100%;
        padding: var(--boxel-sp-xs);
      }

      .account-header-fitted {
        --account-header-logo-size: 40px;
        --account-header-gap: var(--boxel-sp-xs);
        --account-header-logo-border-radius: var(--boxel-border-radius-sm);
        grid-area: account-header-fitted;
        overflow: hidden;
      }

      .account-name {
        font: 600 var(--boxel-font-md);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        width: 100%;
      }

      .description {
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .tag-list {
        margin-top: auto;
        margin-bottom: 0;
        padding: 0;
        list-style-type: none;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }

      /* Vertical card (aspect-ratio <= 1.0) */
      @container fitted-card (aspect-ratio <= 1.0) {
        /* Base styles for smaller vertical cards */
        .account-header-fitted {
          --account-header-logo-size: 40px;
          --account-header-gap: var(--boxel-sp-xs);
          --account-header-logo-border-radius: var(--boxel-border-radius);
        }

        @container (224px <= height < 226px) {
          .account-name {
            -webkit-line-clamp: 3;
          }
        }

        @container (height < 180px) {
          .account-header-fitted {
            --account-header-logo-size: 30px;
          }
          .account-name {
            font: 600 var(--boxel-font);
            -webkit-line-clamp: 2;
          }

          .tag-list {
            display: none;
          }
        }
      }

      /* Horizontal card (aspect-ratio > 1.0) */
      @container fitted-card (aspect-ratio > 1.0) {
        /* Base styles for smaller horizontal cards */
        .account-header-fitted {
          --account-header-logo-size: 40px;
          --account-header-logo-border-radius: var(--boxel-border-radius);
        }

        /* Height-specific adjustments */
        @container (115px <= height <= 150px) {
          .tag-list {
            display: none;
          }
        }

        @container (height <= 114px) {
          .account-header-fitted {
            --account-header-logo-size: 30px;
          }
          .account-name {
            font: 600 var(--boxel-font);
            -webkit-line-clamp: 2;
          }
          .tag-list {
            display: none;
          }
        }

        @container (height <= 57px) {
          .account-header-fitted {
            --account-header-logo-size: 20px;
          }
          .account-name {
            -webkit-line-clamp: 1;
          }
        }
      }
    </style>
  </template>
}

export class Account extends CardDef {
  static displayName = 'Account';
  static headerColor = '#f8f7fa';
  static icon = AccountIcon;
  @field crmApp = linksTo(() => CrmApp);
  @field company = linksTo(() => Company, { isUsed: true });
  @field primaryContact = linksTo(() => Contact, { isUsed: true });
  @field contacts = linksToMany(() => Contact);
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

  static edit = EditTemplate;
  static isolated = IsolatedTemplate;
  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}
