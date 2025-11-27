import {
  CardDef,
  BaseDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
  realmURL,
  FieldDef,
  StringField,
} from 'https://cardstack.com/base/card-api';

import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import MarkdownField from 'https://cardstack.com/base/markdown';
import AddressField from 'https://cardstack.com/base/address';
import WebsiteField from 'https://cardstack.com/base/website';
import PercentageField from 'https://cardstack.com/base/percentage';

import { Query } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import { on } from '@ember/modifier';

import { Account } from './account';
import { Company } from './company';
import { Contact } from './contact';
import { CrmApp } from './crm-app';
import { DealEvent } from './deal-event';
import { DealPriority } from './deal-priority';
import { DealStatus } from './deal-status';

import { AmountWithCurrency as AmountWithCurrencyField } from './fields/amount-with-currency';

import AccountHeader from './components/account-header';
import { ContactRow } from './components/contact-row';
import CrmProgressBar from './components/crm-progress-bar';
import PageLayout from './components/page-layout';
import SummaryCard from './components/summary-card';
import SummaryGridContainer from './components/summary-grid-container';

import {
  BoxelButton,
  FieldContainer,
  Pill,
  SkeletonPlaceholder,
  EntityDisplayWithIcon,
} from '@cardstack/boxel-ui/components';
import { cn, not } from '@cardstack/boxel-ui/helpers';

import Calendar from '@cardstack/boxel-icons/calendar';
import DealIcon from '@cardstack/boxel-icons/handshake';
import Info from '@cardstack/boxel-icons/info';
import MapPin from '@cardstack/boxel-icons/map-pin';
import Users from '@cardstack/boxel-icons/users';
import UsersGroup from '@cardstack/boxel-icons/users-group';
import World from '@cardstack/boxel-icons/world';

interface DealSizeSummary {
  summary: string;
  percentDiff: number;
  positive: boolean;
}

const taskSource = {
  module: new URL('./task', import.meta.url).href,
  name: 'CRMTask',
};

class EditTemplate extends Component<typeof Deal> {
  <template>
    <div class='deal-form'>
      <FieldContainer @label='Name'>
        <@fields.name />
      </FieldContainer>
      <FieldContainer @label='Account'>
        <@fields.account />
      </FieldContainer>
      <FieldContainer @label='Status'>
        <@fields.status />
      </FieldContainer>
      <FieldContainer @label='Priority'>
        <@fields.priority />
      </FieldContainer>
      <FieldContainer @label='Close Date'>
        <@fields.closeDate />
      </FieldContainer>
      <FieldContainer @label='Current Value'>
        <@fields.currentValue />
      </FieldContainer>
      <FieldContainer @label='Predicted Revenue'>
        <@fields.predictedRevenue />
      </FieldContainer>
      <FieldContainer @label='Primary Stakeholder'>
        <@fields.primaryStakeholder />
      </FieldContainer>
      <FieldContainer @label='Stakeholders'>
        <@fields.stakeholders />
      </FieldContainer>
      <FieldContainer @label='Value Breakdown'>
        <@fields.valueBreakdown />
      </FieldContainer>
      <FieldContainer @label='Health Score'>
        <@fields.healthScore />
      </FieldContainer>
      <FieldContainer @label='Event'>
        <@fields.event />
      </FieldContainer>
      <FieldContainer @label='CRM App'>
        <@fields.crmApp />
      </FieldContainer>
      <FieldContainer @label='Logo URL'>
        <@fields.thumbnailURL />
      </FieldContainer>
    </div>
    <style scoped>
      .deal-form {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

class IsolatedTemplate extends Component<typeof Deal> {
  get logoURL() {
    //We default to account thumbnail
    return this.args.model?.thumbnailURL?.length
      ? this.args.model.thumbnailURL
      : this.args.model.account?.thumbnailURL;
  }
  get primaryContactName() {
    return this.args.model.account?.primaryContact?.name;
  }

  get hasDealEventInfo() {
    return this.args.model?.event;
  }

  get eventLocation() {
    return this.args.model?.event?.location?.length
      ? this.args.model.event.location
      : '-';
  }

  get eventDate() {
    return this.args.model?.event?.eventDate
      ? this.args.model.event.eventDate
      : '-';
  }

  get eventAttendees() {
    const attendees = this.args.model?.event?.attendees;
    const attendeesString = attendees
      ? attendees.toString() + ' Expected Attendees'
      : '-';
    return attendeesString;
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

  query = this.args.context?.getCards(
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

    await this.args.createCard?.(taskSource, new URL(taskSource.module), {
      realmURL: this.realmURL,
      doc,
    });
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

  removeFileExtension(cardUrl: string) {
    return cardUrl.replace(/\.[^/.]+$/, '');
  }

  <template>
    <PageLayout @format='isolated'>
      <:header>
        <div class='header-container'>
          <AccountHeader @logoURL={{this.logoURL}} @name={{@model.name}}>
            <:name>
              <h1 class={{cn 'account-name' default-value=(not @model.name)}}>
                {{#if @model.title}}<@fields.title />{{else}}Missing Deal Name{{/if}}
              </h1>
            </:name>
            <:content>
              <div class='info-container'>
                <@fields.company @format='atom' @displayContainer={{false}} />
                {{#if @model.primaryContact}}
                  <@fields.primaryContact
                    @format='atom'
                    @displayContainer={{false}}
                  />
                {{/if}}
              </div>
            </:content>
          </AccountHeader>
          <ul class='tag-list'>
            {{#if @model.status}}
              <Pill
                class='tag'
                @tag='li'
                @pillBackgroundColor={{@model.status.backgroundColor}}
              >
                {{@model.status.label}}
              </Pill>
            {{/if}}
            {{#if @model.priority}}
              <Pill
                class='tag'
                @tag='li'
                @pillBackgroundColor={{@model.priority.backgroundColor}}
              >
                {{@model.priority.label}}
              </Pill>
            {{/if}}
          </ul>
        </div>
      </:header>

      <:summary>
        <SummaryCard class='dashboard' @title='Deal Value'>
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
                  <SkeletonPlaceholder
                    class='skeleton-placeholder-deal-description'
                  />
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
      </:summary>

      <:content>
        <SummaryGridContainer class='task-summary-grid'>
          <SummaryCard @iconComponent={{World}} @title='Deal Info'>
            <:content>
              {{#if this.hasDealEventInfo}}
                <EntityDisplayWithIcon @title={{this.eventLocation}}>
                  <:icon>
                    <MapPin class='info-icon' />
                  </:icon>
                </EntityDisplayWithIcon>

                <EntityDisplayWithIcon @title={{this.eventDate}}>
                  <:icon>
                    <Calendar class='info-icon' />
                  </:icon>
                </EntityDisplayWithIcon>

                <EntityDisplayWithIcon @title={{this.eventAttendees}}>
                  <:icon>
                    <UsersGroup class='info-icon' />
                  </:icon>
                </EntityDisplayWithIcon>
              {{else}}
                <div class='default-value'>
                  Missing Deal Info
                </div>
              {{/if}}
            </:content>
          </SummaryCard>
          <SummaryCard @iconComponent={{Users}} @title='Key Stakeholders'>
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
          <SummaryCard class='tasks-summary-card' @title='Active Tasks'>
            <:icon>
              <BoxelButton
                class='sidebar-create-button'
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
                <SkeletonPlaceholder />
                <SkeletonPlaceholder />
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
                        data-cards-grid-item={{this.removeFileExtension
                          task.id
                        }}
                      >
                        <Component
                          @format='embedded'
                          @displayContainer={{false}}
                        />
                      </div>
                    {{/let}}
                  {{/each}}
                {{else}}
                  <p class='description'>No Active Tasks</p>
                {{/if}}
              {{/if}}
            </:content>
          </SummaryCard>
        </SummaryGridContainer>
      </:content>
    </PageLayout>

    <style scoped>
      h1,
      h2,
      h3,
      h4,
      p {
        margin-block: 0;
      }
      hr {
        border: 0.5px solid var(--boxel-200);
        margin: var(--boxel-sp) 0;
      }
      .header-container {
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
        --summary-card-content-gap: 0;
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
      .tag-list,
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
      .summary-title {
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
      /* Task Summary Grid & Card */
      .tasks-summary-card :deep(.task-card) {
        --task-card-padding: var(--boxel-sp-xxxs) 0;
      }
      .sidebar-create-button {
        font-weight: 600;
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
      /* Skeleton Placeholder */
      .skeleton-placeholder-deal-description {
        --skeleton-height: var(--boxel-font-sm);
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
      .new-item-button {
        font-weight: 600;
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof Deal> {
  get logoURL() {
    return this.args.model?.thumbnailURL?.length
      ? this.args.model.thumbnailURL
      : this.args.model.account?.thumbnailURL;
  }

  get primaryContactName() {
    return this.args.model.account?.primaryContact?.name;
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
    <article class='deal-card-embedded'>
      <header class='deal-header'>
        <AccountHeader
          @logoURL={{this.logoURL}}
          @name={{@model.name}}
          class='account-header-embedded'
        >
          <:name>
            <h1 class={{cn 'account-name' default-value=(not @model.name)}}>
              {{#if @model.title}}<@fields.title />{{else}}Missing Deal Name{{/if}}
            </h1>
          </:name>
          <:content>
            <@fields.company @format='atom' @displayContainer={{false}} />
            {{#if @model.primaryContact}}
              <@fields.primaryContact
                @format='atom'
                @displayContainer={{false}}
              />
            {{/if}}
          </:content>
        </AccountHeader>

        <div class='deal-status'>
          <@fields.status @format='atom' @displayContainer={{false}} />
        </div>

        <div class='account-info-grid-view'>
          <@fields.company @format='atom' @displayContainer={{false}} />
          {{#if @model.primaryContact}}
            <@fields.primaryContact
              @format='atom'
              @displayContainer={{false}}
            />
          {{/if}}
        </div>
      </header>

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

        {{#if @model.event}}
          <div class='event-details'>
            <@fields.event @format='atom' @displayContainer={{false}} />
          </div>
        {{/if}}
      </div>
    </article>

    {{! template-lint-disable no-whitespace-for-layout  }}
    {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
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
      .highlight-value {
        font-weight: 600;
        font-size: var(--boxel-font-size);
        white-space: nowrap;
      }
      .progress-container {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
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
      .account-info-grid-view {
        display: none; /* Hidden by default */
      }

      /* Default card layout with container query setup */
      .deal-card-embedded {
        display: grid;
        width: 100%;
        height: 100%;
        grid-template-areas: 'deal-header' 'deal-content';
        grid-template-columns: 100%;
        grid-template-rows: max-content auto;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        container-type: inline-size;
      }
      .deal-header {
        grid-area: deal-header;
        display: grid;
        grid-template-areas: 'account-header-embedded deal-status';
        grid-template-columns: 1fr auto;
        align-items: start;
        gap: var(--boxel-sp-lg);
      }
      .deal-content {
        grid-area: deal-content;
        display: grid;
        grid-template-areas: 'deal-details event-details';
        grid-template-columns: 1fr auto;
        grid-template-rows: max-content;
        align-items: end;
        justify-content: space-between;
        gap: var(--boxel-sp-lg);
        margin-top: auto;
      }
      .deal-content:not(:has(.event-details)) {
        grid-template-areas: 'deal-details';
        grid-template-columns: 100%;
        grid-template-rows: 1fr;
      }
      .deal-content:not(:has(.deal-details)) {
        grid-template-areas: 'event-details';
        grid-template-columns: 100%;
        grid-template-rows: 1fr;
      }
      .deal-status {
        grid-area: deal-status;
        margin-left: auto;
      }
      .deal-details {
        grid-area: deal-details;
        display: grid;
        grid-template-rows: auto;
        grid-template-columns: max-content max-content max-content;
        gap: var(--boxel-sp-xl);
      }
      .deal-field {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }
      .deal-field:nth-child(1),
      .deal-field:nth-child(2),
      .deal-field:nth-child(3) {
        grid-row: 1;
      }
      .account-header-embedded {
        --account-header-logo-size: 40px;
        --account-header-gap: var(--boxel-sp-xs);
        --account-header-logo-border-radius: var(--boxel-border-radius-sm);
        grid-area: account-header-embedded;
        overflow: hidden;
      }
      .event-details {
        grid-area: event-details;
      }

      /* Container query for mobile adjustments */
      @container (max-inline-size: 600px) {
        /* Stack deal-header into a column */
        .deal-header {
          grid-template-areas:
            'account-header-embedded'
            'deal-status';
          grid-template-columns: 100%;
          grid-template-rows: auto auto;
          gap: var(--boxel-sp-sm);
        }
        .deal-status {
          display: none;
        }

        /* Stack deal-content  */
        .deal-content {
          grid-template-areas:
            'deal-details'
            'event-details';
          grid-template-columns: 100%;
          grid-template-rows: auto auto;
          gap: var(--boxel-sp-sm);
          margin-top: var(--boxel-sp-lg);
        }
        .deal-details {
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
        }
        .deal-details :deep(.progress-bar) {
          flex-grow: 1;
        }

        .event-details {
          --event-summary-icon-size: 0px;
          --entity-display-gap: 0px;
        }

        /* Ensure that the first two fields appear in row 1 */
        .deal-field:nth-child(1),
        .deal-field:nth-child(2) {
          grid-row: 1;
        }

        /* Make the health score field take full width in row 2 */
        .deal-field:nth-child(3) {
          grid-row: 2;
          grid-column: 1 / -1;
        }

        .account-header-embedded {
          --account-header-info-content-display: none;
        }
        .account-info-grid-view {
          display: grid;
          width: 100%;
          grid-template-columns: 1fr;
          gap: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof Deal> {
  get logoURL() {
    //We default to account thumbnail
    return this.args.model?.thumbnailURL?.length
      ? this.args.model.thumbnailURL
      : this.args.model.account?.thumbnailURL;
  }

  get primaryContactName() {
    return this.args.model.account?.primaryContact?.name;
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
    <article class='deal-card-fitted'>
      <header class='deal-header'>
        <AccountHeader
          @logoURL={{this.logoURL}}
          @name={{@model.name}}
          class='account-header-fitted'
        >
          <:name>
            <h1 class={{cn 'account-name' default-value=(not @model.name)}}>
              {{#if @model.title}}<@fields.title />{{else}}Missing Deal Name{{/if}}
            </h1>
          </:name>
          <:content>
            <@fields.company @format='atom' @displayContainer={{false}} />
            {{#if @model.primaryContact}}
              <@fields.primaryContact
                @format='atom'
                @displayContainer={{false}}
              />
            {{/if}}
          </:content>
        </AccountHeader>

        <div class='deal-status'>
          <@fields.status @format='atom' @displayContainer={{false}} />
        </div>

        <div class='account-info-grid-view'>
          <@fields.company @format='atom' @displayContainer={{false}} />
          {{#if @model.primaryContact}}
            <@fields.primaryContact
              @format='atom'
              @displayContainer={{false}}
            />
          {{/if}}
        </div>
      </header>

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

        {{#if @model.event}}
          <div class='event-details'>
            <@fields.event @format='atom' @displayContainer={{false}} />
          </div>
        {{/if}}
      </div>
    </article>

    <style scoped>
      /* Base styles */
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
      .highlight-value {
        font-weight: 600;
        font-size: var(--boxel-font-size);
        white-space: nowrap;
      }
      .progress-container {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
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
      .account-info-grid-view {
        display: none;
      }

      /* Default card layout */
      .deal-card-fitted {
        display: grid;
        width: 100%;
        height: 100%;
        grid-template-areas: 'deal-header' 'deal-content';
        grid-template-columns: 100%;
        grid-template-rows: max-content auto;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
      }
      .deal-header {
        grid-area: deal-header;
        display: grid;
        grid-template-areas: 'account-header-fitted deal-status';
        grid-template-columns: 1fr auto;
        align-items: start;
        gap: var(--boxel-sp-lg);
      }
      .deal-content {
        grid-area: deal-content;
        display: grid;
        grid-template-areas: 'deal-details event-details';
        grid-template-columns: 1fr auto;
        grid-template-rows: max-content;
        align-items: end;
        justify-content: space-between;
        gap: var(--boxel-sp-lg);
        margin-top: auto;
      }
      .deal-content:not(:has(.event-details)) {
        grid-template-areas: 'deal-details';
        grid-template-columns: 100%;
        grid-template-rows: 1fr;
      }
      .deal-content:not(:has(.deal-details)) {
        grid-template-areas: 'event-details';
        grid-template-columns: 100%;
        grid-template-rows: 1fr;
      }
      .deal-status {
        grid-area: deal-status;
        margin-left: auto;
      }
      .deal-details {
        grid-area: deal-details;
        display: grid;
        grid-template-rows: auto;
        grid-template-columns: max-content max-content max-content;
        gap: var(--boxel-sp-xl);
      }

      .deal-field {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }

      /* Make the first three fields appear in row 1 */
      .deal-field:nth-child(1),
      .deal-field:nth-child(2),
      .deal-field:nth-child(3) {
        grid-row: 1;
      }

      .account-header-fitted {
        --account-header-logo-size: 40px;
        --account-header-gap: var(--boxel-sp-xs);
        --account-header-logo-border-radius: var(--boxel-border-radius-sm);
        grid-area: account-header-fitted;
        overflow: hidden;
      }
      .event-details {
        grid-area: event-details;
      }

      /* Vertical card (aspect-ratio <= 1.0) */
      @container fitted-card (aspect-ratio <= 1.0) {
        .deal-card-fitted {
          padding: var(--boxel-sp-xs);
        }
        .account-header-fitted {
          --account-header-logo-size: 40px;
          --account-header-gap: var(--boxel-sp-xs);
          --account-header-logo-border-radius: var(--boxel-border-radius);
          --account-header-info-content-display: none;
        }
        .account-info-grid-view :deep(.avatar) {
          --profile-avatar-icon-size: var(--boxel-font-size);
          --profile-avatar-icon-border: 0px;
        }
        .account-name {
          font: 600 var(--boxel-font);
        }
        .deal-status {
          display: none;
        }
        .deal-details {
          grid-template-columns: 1fr 1fr;
        }

        /* Ensure that the first two fields appear in row 1 */
        .deal-field:nth-child(1),
        .deal-field:nth-child(2) {
          grid-row: 1;
        }

        /* Make the health score field take full width in row 2 */
        .deal-field:nth-child(3) {
          grid-row: 2;
          grid-column: 1 / -1;
        }

        /* Base styles for deal-content and event-details */
        .deal-content {
          grid-template-areas:
            'deal-details'
            'event-details';
          grid-template-rows: max-content auto;
          grid-template-columns: 100%;
          gap: var(--boxel-sp);
        }
        .deal-details {
          gap: var(--boxel-sp);
        }
        .deal-details :deep(.progress-bar) {
          flex-grow: 1;
        }
        .event-details {
          --event-summary-padding: var(--boxel-sp-xs);
          --event-summary-gap: var(--boxel-sp);
          --event-summary-icon-size: 0px;
          --event-summary-content-font-size: var(--boxel-font-size-xs);
          --entity-display-gap: 0px;
        }
        .highlight-value {
          font-size: var(--boxel-font-size-xs);
        }

        /* Height-specific overrides */
        @container fitted-card (height >= 275px) {
          .deal-header {
            grid-template-areas: 'account-header-fitted' 'account-info-grid-view';
            grid-template-columns: 100%;
            grid-template-rows: max-content max-content;
            gap: var(--boxel-sp-sm);
          }
          .account-info-grid-view {
            display: flex;
            flex-direction: column;
            gap: var(--boxel-sp-sm);
            --entity-display-icon-size: var(--boxel-font-size);
            --entity-display-thumbnail-size: var(--boxel-font-size);
            --entity-display-title-font-size: var(--boxel-font-size-xs);
          }
        }

        @container fitted-card (height < 275px) and (height >= 250px) {
          .deal-header {
            grid-template-areas: 'account-header-fitted';
            grid-template-columns: 100%;
            grid-template-rows: max-content;
            gap: var(--boxel-sp-xs);
          }
          .account-info-grid-view {
            display: none;
          }
        }

        @container fitted-card (height < 250px) {
          .deal-card-fitted {
            grid-template-areas: 'deal-header';
            grid-template-rows: 1fr;
          }
          .deal-content {
            display: none;
          }
          .deal-header {
            grid-template-areas: 'account-header-fitted';
          }
          .account-header-fitted {
            --account-header-logo-size: 25px;
            --account-header-logo-border-radius: var(--boxel-border-radius);
          }
        }

        @container fitted-card (height <= 170px) {
          .account-header-fitted {
            --account-header-logo-size: 25px;
            --account-header-logo-border-radius: var(--boxel-border-radius);
          }
          .account-info-grid-view {
            display: none;
          }
        }
      }

      /* Horizontal card (aspect-ratio > 1.0) */
      @container fitted-card (1.0 < aspect-ratio) {
        .deal-card-fitted {
          padding: var(--boxel-sp-xs);
        }
        .account-header-fitted {
          --account-header-logo-size: 60px;
          --account-header-gap: var(--boxel-sp-xs);
          --account-header-logo-border-radius: var(--boxel-border-radius-xl);
          --account-header-info-content-display: none;
        }
        .account-name {
          font: 600 var(--boxel-font-md);
          -webkit-line-clamp: 1;
        }

        /* Height > 180px */
        @container fitted-card (180px < height) {
          .deal-content {
            grid-template-areas: 'deal-details' 'event-details';
            grid-template-columns: 100%;
            gap: var(--boxel-sp-lg);
          }
          .deal-details {
            gap: var(--boxel-sp);
          }
          .event-details {
            --event-summary-padding: var(--boxel-sp-xs);
            --event-summary-gap: var(--boxel-sp);
            --event-summary-icon-size: 0px;
            --event-summary-content-font-size: var(--boxel-font-size-xs);
            --entity-display-gap: 0px;
          }
          .highlight-value {
            font-size: var(--boxel-font-size-xs);
          }
        }

        /* Height < 180px */
        @container fitted-card (height < 180px) {
          .deal-card-fitted {
            grid-template-areas: 'deal-header';
            grid-template-rows: 1fr;
          }
          .deal-content,
          .deal-status {
            display: none;
          }
          .deal-header {
            grid-template-areas: 'account-header-fitted';
          }
          .account-header-fitted {
            --account-header-logo-size: 25px;
            --account-header-logo-border-radius: var(--boxel-border-radius);
          }
        }

        /* Height 115px - 150px */
        @container fitted-card (115px <= height <= 150px) {
          .deal-header {
            grid-template-areas: 'account-header-fitted' 'account-info-grid-view';
            grid-template-rows: max-content max-content;
            gap: var(--boxel-sp-xs);
          }
          .account-info-grid-view {
            display: flex;
            flex-direction: column;
            gap: var(--boxel-sp);
            --entity-display-icon-size: var(--boxel-font-size);
            --entity-display-thumbnail-size: var(--boxel-font-size);
            --entity-display-title-font-size: var(--boxel-font-size-xs);
          }
        }

        /* Height <= 57px */
        @container fitted-card (height <= 57px) {
          .account-header-fitted {
            --account-header-logo-size: 25px;
          }
          .account-name {
            font: 600 var(--boxel-font-sm);
            -webkit-line-clamp: 1;
          }
        }
      }

      /* Custom breakpoints */
      @container fitted-card (width < 200px) and (226px <= height) and (aspect-ratio <= 1.0) {
        .deal-header {
          grid-template-areas: 'account-header-fitted';
        }
        .account-info-grid-view {
          display: none;
        }
        .deal-details {
          gap: var(--boxel-sp-xs);
        }
        .account-name {
          -webkit-line-clamp: 2;
        }
      }

      @container fitted-card (aspect-ratio >= 1.0) and (width < 400px) and (height <= 275px) {
        .account-header-fitted {
          --account-header-logo-size: 25px;
          --account-header-gap: var(--boxel-sp-xs);
          --account-header-logo-border-radius: var(--boxel-border-radius);
          --account-header-info-content-display: none;
        }
        .account-name {
          font: 600 var(--boxel-font);
          -webkit-line-clamp: 1;
        }
        .deal-header {
          grid-template-areas: 'account-header-fitted';
        }
        .account-info-grid-view,
        .deal-status,
        .deal-content {
          display: none;
        }
      }

      @container fitted-card (800px < width) and (170px < height) {
        .account-header-fitted {
          --account-header-info-content-display: flex;
        }
        .deal-content {
          grid-template-areas: 'deal-details event-details';
          grid-template-columns: max-content auto;
        }
        .event-details {
          --event-summary-padding: var(--boxel-sp);
          --event-summary-gap: var(--boxel-sp-lg);
          --event-summary-icon-size: var(--boxel-font-size);
          --event-summary-content-font-size: var(--boxel-font-size);
          --entity-display-content-gap: var(--boxel-sp-xs);
          --event-summary-venue-text-max-width: 300px;
        }
      }

      @container fitted-card (width < 800px) {
        @container fitted-card (height < 170px) {
          .event-details {
            display: none;
          }
        }
        @container fitted-card (height <= 275px) {
          .deal-status,
          .deal-details {
            display: none;
          }
        }
      }
    </style>
  </template>
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
  static displayName = 'Deal';
  static headerColor = '#f8f7fa';
  static icon = DealIcon;
  @field crmApp = linksTo(() => CrmApp);
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
  @field event = linksTo(() => DealEvent);
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
  @field primaryContact = linksTo(() => Contact, {
    computeVia: function (this: Deal) {
      return this.account?.primaryContact;
    },
  });
  //TODO: Fix after CS-7670. Maybe no fix needed
  @field company = linksTo(() => Company, {
    computeVia: function (this: Deal) {
      return this.account?.company;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: Deal) {
      return this.name;
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
