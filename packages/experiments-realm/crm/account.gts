import {
  CardDef,
  linksTo,
  contains,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { Component, BaseDef } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import {
  field,
  linksToMany,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Address as AddressField } from '../address';
import { Company } from './company';
import { Contact } from './contact';
import { StatusTagField } from './contact-status-tag';
import SummaryCard from '../components/summary-card';
import SummaryGridContainer from '../components/summary-grid-container';
import BuildingIcon from '@cardstack/boxel-icons/building';
import ChartBarPopular from '@cardstack/boxel-icons/chart-bar-popular';
import AccountHeader from '../components/account-header';
import { WebsiteField } from '../website';
import TrendingUp from '@cardstack/boxel-icons/trending-up';
import ContactIcon from '@cardstack/boxel-icons/contact';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import PlusIcon from '@cardstack/boxel-icons/plus';
import CalendarTime from '@cardstack/boxel-icons/calendar-time';
import { Pill } from '@cardstack/boxel-ui/components';
import { Query } from '@cardstack/runtime-common/query';
import { getCards } from '@cardstack/runtime-common';
import { Deal } from './deal';
import EntityIconDisplay from '../components/entity-icon-display';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import { restartableTask } from 'ember-concurrency';
import { on } from '@ember/modifier';
import { not } from '@cardstack/boxel-ui/helpers';
import { UrgencyTag } from './urgency-tag';

const taskSource = {
  module: new URL('./task', import.meta.url).href,
  name: 'CRMTask',
};

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

  deals = getCards(
    () => this.dealQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  activeTasks = getCards(
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

  lifetimeValueDeals = getCards(
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
                <@fields.headquartersAddress @format='atom' />
                <@fields.website @format='atom' />
              {{else}}
                <div class='default-value'>
                  Missing Company Info
                </div>
              {{/if}}
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

          <SummaryCard>
            <:title>
              <h3 class='summary-title'>Lifetime Value</h3>
            </:title>
            <:icon>
              <ChartBarPopular class='header-icon' />
            </:icon>
            <:content>
              {{#if this.lifetimeValueDeals.isLoading}}
                <h3 class='summary-highlight'>Loading...</h3>
                <p class='description'>Loading...</p>
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

          <SummaryCard>
            <:title>
              <h3 class='summary-title'>Active Deals</h3>
            </:title>
            <:icon>
              <TrendingUp class='header-icon' />
            </:icon>
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
            {{! remove activity mock }}
          </:content>
        </SummaryCard>
      </:activities>

      <:tasks>
        <SummaryCard class='tasks-summary-card'>
          <:title>
            <h2 class='activity-title'>Upcoming Tasks</h2>
          </:title>
          <:icon>
            <BoxelButton
              @kind='primary'
              class='activity-button-mobile'
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
              class='activity-button-desktop'
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
              <div class='loading-skeleton'>Loading...</div>
            {{else}}
              {{#if this.hasActiveTasks}}
                {{#each this.activeTasks.instances as |task|}}
                  {{#let (getComponent task) as |Component|}}
                    <Component @format='embedded' @displayContainer={{false}} />
                  {{/let}}
                {{/each}}
              {{else}}
                <p class='description'>No Upcoming Tasks</p>
              {{/if}}
            {{/if}}
          </:content>
        </SummaryCard>
      </:tasks>
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
      .primary-contact-group {
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
      .description {
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
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
      .tasks-summary-card {
        --summary-card-content-gap: 0;
      }
      .tasks-summary-card :where(.task-card) {
        --task-card-padding: var(--boxel-sp) 0;
        border-top: 1px solid var(--boxel-200);
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
      .avatar {
        --profile-avatar-icon-size: 20px;
        --profile-avatar-icon-border: 0px;
        flex-shrink: 0;
      }
      .loading-skeleton {
        height: 60px;
        width: 100%;
        background-color: var(--boxel-100);
        border-radius: var(--boxel-border-radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
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

  deals = getCards(
    () => this.dealQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  activeTasks = getCards(
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

  lifetimeValueDeals = getCards(
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
    <AccountPageLayout class='account-page-layout-embedded'>
      <:header>
        <div class='top-bar'>
          <AccountHeader @logoURL={{@model.thumbnailURL}} @name={{@model.name}}>
            <:name>
              {{#if @model.name}}
                <h1 class='account-name'>{{@model.name}}</h1>
              {{else}}
                <h1 class='account-name default-value'>Missing Account Name</h1>
              {{/if}}
            </:name>
            <:content>
              {{#if @model.primaryContact}}
                <div class='tag-container'>
                  <@fields.statusTag @format='atom' />
                  <@fields.urgencyTag @format='atom' />
                </div>
              {{/if}}
            </:content>
          </AccountHeader>
          <BuildingIcon class='header-icon' />
        </div>
      </:header>
      <:summary>
        <section class='summary-articles-container'>
          <SummaryGridContainer>
            <SummaryCard>
              <:title>
                <h3 class='summary-title'>Lifetime Value</h3>
              </:title>
              <:icon>
                <ChartBarPopular class='header-icon' />
              </:icon>
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

            <SummaryCard>
              <:title>
                <h3 class='summary-title'>Active Deals</h3>
              </:title>
              <:icon>
                <TrendingUp class='header-icon' />
              </:icon>
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
              <div class='contact-display'>
                {{#if @model.primaryContact}}
                  <@fields.primaryContact
                    @format='atom'
                    @displayContainer={{false}}
                  />
                {{/if}}
              </div>
            </article>

            <article>
              <label>NEXT STEPS</label>
              <div class='next-steps-display'>
                {{! TODO: Add activity tasks after lucas pr go in }}
                <EntityIconDisplay @title='--'>
                  <:icon>
                    <CalendarTime />
                  </:icon>
                </EntityIconDisplay>
              </div>
            </article>

            <article>
              <label>PRIORITY TASKS</label>
              {{#if this.activeTasks.isLoading}}
                <div class='loading-skeleton'>Loading...</div>
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
    </AccountPageLayout>
    <style scoped>
      h3,
      p {
        margin: 0;
      }
      .account-page-layout-embedded {
        --account-page-layout-padding: var(--boxel-sp-sm);
        height: 100%;
        container-type: inline-size;
        container-name: account-page-layout-embedded;
      }
      .top-bar {
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
      .header-icon {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        flex-shrink: 0;
        margin-left: auto;
      }
      .tag-container {
        margin-top: auto;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
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
      article > * + * {
        margin-top: var(--boxel-sp-xs);
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
      .contact-display {
        --entity-display-icon-size: var(--boxel-icon-sm);
        --entity-display-content-gap: var(--boxel-sp-xs);
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
      .loading-skeleton {
        height: 60px;
        width: 100%;
        background: var(--boxel-light-300);
        border-radius: var(--boxel-border-radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      @container account-page-layout-embedded (max-width: 447px) {
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
    <AccountPageLayout class='account-page-layout-fitted'>
      <:header>
        <AccountHeader
          class='account-header-fitted'
          @logoURL={{@model.thumbnailURL}}
          @name={{@model.name}}
        >
          <:name>
            {{#if @model.name}}
              <h1 class='account-name'>{{@model.name}}</h1>
            {{else}}
              <h1 class='account-name default-value'>Missing Account Name</h1>
            {{/if}}
          </:name>
        </AccountHeader>
      </:header>
      <:summary>
        {{#if @model.primaryContact}}
          <div class='tag-container'>
            <@fields.statusTag @format='atom' />
            <@fields.urgencyTag @format='atom' />
          </div>
        {{/if}}
      </:summary>
    </AccountPageLayout>

    <style scoped>
      .account-page-layout-fitted {
        --account-page-layout-padding: var(--boxel-sp-sm);
        height: 100%;
      }
      .account-header-fitted {
        gap: var(--boxel-sp-sm);
        --account-header-logo-size: 40px;
      }
      .account-name {
        font: 600 var(--boxel-font);
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .description {
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .tag-container {
        margin-top: auto;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }

      @container fitted-card (aspect-ratio <= 1.0) and (128px <= height < 148px) {
        .tag-container {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (118px <= height < 128px) {
        .tag-container {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 0.5) and (height < 300px) {
        .tag-container {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (78px <= height <= 114px)) {
        .account-name {
          font: 600 var(--boxel-font-sm);
        }
        .tag-container {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (500px <= width) and (58px <= height <= 77px)) {
        .account-name {
          font: 600 var(--boxel-font-sm);
        }
        .tag-container {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (226px <= width <= 499px) and (58px <= height <= 77px)) {
        .account-name {
          font: 600 var(--boxel-font-sm);
        }
        .tag-container {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (width <= 225px) and (58px <= height <= 77px)) {
        .account-name {
          font: 600 var(--boxel-font-sm);
        }
        .tag-container {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (height <= 57px)) {
        .account-name {
          font: 600 var(--boxel-font-sm);
        }
        .tag-container {
          display: none;
        }
      }

      @container fitted-card (2.0 < aspect-ratio) and (height <= 57px) {
        .account-page-layout-fitted {
          --account-page-layout-padding: var(--boxel-sp-xs);
        }
        .account-header-fitted {
          --account-header-logo-display: none;
        }
      }
    </style>
  </template>
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
  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}

interface AccountPageLayoutArgs {
  Blocks: {
    header: [];
    summary: [];
    activities: [];
    tasks: [];
  };
  Element: HTMLElement;
}

class AccountPageLayout extends GlimmerComponent<AccountPageLayoutArgs> {
  <template>
    <div class='account-page-layout' ...attributes>
      {{yield to='header'}}
      {{yield to='summary'}}
      {{yield to='activities'}}
      {{yield to='tasks'}}
    </div>

    <style scoped>
      .account-page-layout {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        width: 100%;
        padding: var(--account-page-layout-padding, 20px);
        box-sizing: border-box;
      }
    </style>
  </template>
}

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}
