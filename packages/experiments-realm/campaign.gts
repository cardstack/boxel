import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import { htmlSafe } from '@ember/template';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';
import AmountWithCurrency from 'https://cardstack.com/base/amount-with-currency';
import enumField from 'https://cardstack.com/base/enum';
import SpeakerphoneIcon from '@cardstack/boxel-icons/speakerphone';
import { formatMoney } from './money';

// Mirrors the channels Lead.source names, so a lead's channel and the specific
// activity it came from describe the same thing at two levels of detail.
const CampaignTypeField = enumField(StringField, {
  options: ['webinar', 'ad', 'event', 'email', 'content', 'other'],
  displayName: 'Campaign Type',
});

const CampaignStatusField = enumField(StringField, {
  options: ['planned', 'running', 'completed', 'canceled'],
  displayName: 'Campaign Status',
});

export class Campaign extends CardDef {
  static displayName = 'Campaign';
  static icon = SpeakerphoneIcon;

  @field name = contains(StringField);
  @field campaignType = contains(CampaignTypeField);
  @field status = contains(CampaignStatusField);
  @field startDate = contains(DateField);
  @field endDate = contains(DateField);
  @field budget = contains(AmountWithCurrency);
  @field spend = contains(AmountWithCurrency);

  @field budgetUsedPercent = contains(NumberField, {
    computeVia: function (this: Campaign) {
      let budget = this.budget?.amount ?? 0;
      let spend = this.spend?.amount ?? 0;
      if (!budget) return 0;
      return Math.round((spend / budget) * 100);
    },
  });

  @field isOverBudget = contains(BooleanField, {
    computeVia: function (this: Campaign) {
      let budget = this.budget?.amount ?? 0;
      return budget > 0 && (this.spend?.amount ?? 0) > budget;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Campaign) {
      return this.name?.trim()?.length
        ? this.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Campaign> {
    <template>
      <span class='campaign-atom'>
        <SpeakerphoneIcon class='ca-icon' />
        <span class='ca-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .campaign-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          min-width: 0;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .ca-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .ca-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Campaign> {
    get spendDisplay() {
      return formatMoney(
        this.args.model?.spend?.amount,
        this.args.model?.spend?.currency?.code,
      );
    }
    <template>
      <div class='campaign'>
        <SpeakerphoneIcon class='icon' />
        <div class='info'>
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.campaignType}}
            <span class='meta'>{{@model.campaignType}}</span>
          {{/if}}
        </div>
        <span class='figure'>{{if this.spendDisplay this.spendDisplay '—'}}</span>
        {{#if @model.status}}
          <span class='status status-{{@model.status}}'>{{@model.status}}</span>
        {{/if}}
      </div>
      <style scoped>
        .campaign {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
        }
        .icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .info {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          text-transform: capitalize;
        }
        .figure {
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .status {
          width: 6rem;
          text-align: center;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .status-running {
          background: var(--state-positive-bg, #dcfce7);
          color: var(--state-positive-fg, #166534);
        }
        .status-planned {
          background: var(--state-partial-bg, #fef3c7);
          color: var(--state-partial-fg, #92400e);
        }
        .status-canceled {
          background: var(--state-overdue-bg, #fee2e2);
          color: var(--state-overdue-fg, #991b1b);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Campaign> {
    get spendDisplay() {
      return formatMoney(
        this.args.model?.spend?.amount,
        this.args.model?.spend?.currency?.code,
      );
    }
    get budgetNote() {
      let budget = this.args.model?.budget?.amount;
      if (!budget) return '';
      let of = formatMoney(budget, this.args.model?.budget?.currency?.code);
      return `${this.args.model?.budgetUsedPercent}% of ${of}`;
    }
    <template>
      <div class='fitted'>
        <div class='top'>
          <SpeakerphoneIcon class='icon' />
          {{#if @model.status}}
            <span class='status status-{{@model.status}}'>{{@model.status}}</span>
          {{/if}}
        </div>
        <span class='name'>{{@model.cardTitle}}</span>
        {{#if this.spendDisplay}}
          <span class='figure'>{{this.spendDisplay}}</span>
        {{/if}}
        {{#if @model.campaignType}}
          <span class='meta line-type'>{{@model.campaignType}}</span>
        {{/if}}
        {{#if this.budgetNote}}
          <span
            class='meta line-budget {{if @model.isOverBudget "over"}}'
          >{{this.budgetNote}}</span>
        {{/if}}
        {{#if @model.startDate}}
          <span class='meta line-dates'>Ran
            <@fields.startDate />
            –
            <@fields.endDate /></span>
        {{/if}}
      </div>
      <style scoped>
        .fitted {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          padding: 0.625rem 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          overflow: hidden;
          color: var(--foreground, #111111);
        }
        .top {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .icon {
          width: 16px;
          height: 16px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .status {
          margin-left: auto;
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.0625rem 0.375rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .status-running {
          background: var(--state-positive-bg, #dcfce7);
          color: var(--state-positive-fg, #166534);
        }
        .status-planned {
          background: var(--state-partial-bg, #fef3c7);
          color: var(--state-partial-fg, #92400e);
        }
        .status-canceled {
          background: var(--state-overdue-bg, #fee2e2);
          color: var(--state-overdue-fg, #991b1b);
        }
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .figure {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-transform: capitalize;
        }
        .over {
          color: var(--state-overdue-fg, #991b1b);
          font-weight: 600;
        }
        .line-type,
        .line-budget,
        .line-dates {
          display: none;
        }
        /* Each taller tier adds a line, so a tile fills its box. */
        @container fitted-card (min-height: 170px) {
          .line-type,
          .line-budget {
            display: block;
          }
          .line-type {
            margin-top: auto;
          }
        }
        @container fitted-card (min-height: 215px) {
          .line-dates {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Campaign> {
    get spendDisplay() {
      return formatMoney(
        this.args.model?.spend?.amount,
        this.args.model?.spend?.currency?.code,
      );
    }
    get budgetDisplay() {
      return formatMoney(
        this.args.model?.budget?.amount,
        this.args.model?.budget?.currency?.code,
      );
    }
    get barStyle() {
      let pct = Math.min(this.args.model?.budgetUsedPercent ?? 0, 100);
      return htmlSafe(`width: ${pct}%`);
    }
    <template>
      <article class='campaign-page'>
        <header class='ch'>
          <div class='ch-id'>
            <p class='doc-kind'>Campaign</p>
            <h1>{{@model.cardTitle}}</h1>
            <p class='status-line'>{{@model.campaignType}}{{#if @model.status}}
                ·
                {{@model.status}}{{/if}}</p>
          </div>
        </header>

        {{#if this.budgetDisplay}}
          <section class='panel'>
            <h2>Budget</h2>
            <div class='spend-row'>
              <span class='spend'>{{this.spendDisplay}}</span>
              <span class='of'>of {{this.budgetDisplay}}</span>
            </div>
            {{! template-lint-disable no-inline-styles }}
            <div class='bar'>
              <div
                class='bar-fill {{if @model.isOverBudget "bar-over"}}'
                style={{this.barStyle}}
              ></div>
            </div>
            <p class='bar-note {{if @model.isOverBudget "over"}}'>
              {{@model.budgetUsedPercent}}% spent{{#if @model.isOverBudget}}
                — over budget{{/if}}
            </p>
          </section>
        {{/if}}

        <section class='panel'>
          <h2>Details</h2>
          <dl>
            {{#if @model.startDate}}
              <dt>Started</dt>
              <dd><@fields.startDate /></dd>
            {{/if}}
            {{#if @model.endDate}}
              <dt>Ended</dt>
              <dd><@fields.endDate /></dd>
            {{/if}}
          </dl>
          <p class='hint'>Leads attributed to this campaign are counted by
            querying leads that point at it — a campaign does not hold a list of
            them.</p>
        </section>
      </article>
      <style scoped>
        .campaign-page {
          max-width: 42rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          color: var(--foreground, #111111);
        }
        .ch {
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .doc-kind {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.625rem;
          font-family: var(--font-heading, inherit);
        }
        .status-line {
          margin: 0.25rem 0 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
          text-transform: capitalize;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 8px;
          padding: 1rem 1.125rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .spend-row {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
        }
        .spend {
          font-size: 1.5rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-family: var(--font-heading, inherit);
        }
        .of {
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
        }
        .bar {
          margin-top: 0.625rem;
          height: 8px;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          background: var(--primary, #111111);
        }
        .bar-over {
          background: var(--state-overdue-fg, #991b1b);
        }
        .bar-note {
          margin: 0.375rem 0 0;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
        .over {
          color: var(--state-overdue-fg, #991b1b);
          font-weight: 600;
        }
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: 7rem 1fr;
          gap: 0.5rem 1rem;
          font-size: 0.875rem;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
        }
        .hint {
          margin: 0.875rem 0 0;
          font-size: 0.75rem;
          line-height: 1.5;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };
}
