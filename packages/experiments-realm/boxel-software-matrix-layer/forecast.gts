import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import TargetIcon from '@cardstack/boxel-icons/target';
import { Territory } from './territory';
import { formatMoney } from './money';

// Forecast — a rolled-up projection of expected revenue for a territory over
// a period.
//
// PROJECTED AMOUNT IS A SNAPSHOT, NOT A LIVE COMPUTATION. A computeVia field
// can only derive from this card's OWN data, not run a live cross-realm
// query over every open Opportunity — so, same principle as this realm's
// Order ("fees are snapshots, not rates") and the new Tax Breakdown field,
// `projectedAmount` is written by whatever recalculates it (a future
// `recalculate-forecast-command`, not built in this pass) and stamped with
// `calculatedAt` so a stale forecast is visibly stale rather than silently
// wrong. The recalculation itself reuses `revenue-os.gts`'s own existing
// forecast-window math (`effectiveProbability`-weighted sum, filtered by
// close-date window) rather than inventing a second formula.

export class Forecast extends CardDef {
  static displayName = 'Forecast';
  static icon = TargetIcon;

  @field territory = linksTo(Territory);
  @field period = contains(StringField);
  @field projectedAmount = contains(AmountWithCurrency);
  @field calculatedAt = contains(DateField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Forecast) {
      let territoryName = this.territory?.name;
      return this.period?.trim()?.length
        ? territoryName
          ? `${territoryName} — ${this.period}`
          : this.period
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Forecast> {
    <template>
      <span class='forecast-atom'>
        <TargetIcon class='fa-icon' />
        <span class='fa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .forecast-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .fa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .fa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Forecast> {
    get amountDisplay() {
      return formatMoney(
        this.args.model?.projectedAmount?.amount,
        this.args.model?.projectedAmount?.currency?.code,
      );
    }
    <template>
      <div class='forecast-row'>
        <TargetIcon class='icon' />
        <div class='info'>
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.calculatedAt}}
            <span class='meta'>as of
              <@fields.calculatedAt /></span>
          {{/if}}
        </div>
        {{#if this.amountDisplay}}
          <span class='value'>{{this.amountDisplay}}</span>
        {{/if}}
      </div>
      <style scoped>
        .forecast-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
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
          gap: 0.125rem;
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
        }
        .value {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Forecast> {
    get amountDisplay() {
      return (
        formatMoney(
          this.args.model?.projectedAmount?.amount,
          this.args.model?.projectedAmount?.currency?.code,
        ) || '—'
      );
    }
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <TargetIcon class='doc-icon' />
          <span class='figure'>{{this.amountDisplay}}</span>
        </div>
        <div class='fmt strip'>
          <TargetIcon class='doc-icon' />
          <div class='info'>
            <span class='name'>{{@model.cardTitle}}</span>
          </div>
          <span class='figure'>{{this.amountDisplay}}</span>
        </div>
        <div class='fmt tile'>
          <TargetIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
          <span class='figure figure-lg'>{{this.amountDisplay}}</span>
        </div>
        <div class='fmt card'>
          <div class='col'>
            <div class='row'>
              <TargetIcon class='doc-icon' />
              <span class='name name-lg'>{{@model.cardTitle}}</span>
            </div>
            {{#if @model.calculatedAt}}
              <span class='meta'>as of
                <@fields.calculatedAt /></span>
            {{/if}}
          </div>
          <span class='figure figure-lg'>{{this.amountDisplay}}</span>
        </div>
      </div>
      <style scoped>
        .fitted {
          width: 100%;
          height: 100%;
          color: var(--foreground, #111111);
        }
        .fmt {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }
        .doc-icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .name-lg {
          font-size: 0.9375rem;
        }
        .figure {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-size: 0.875rem;
          white-space: nowrap;
        }
        .figure-lg {
          font-size: 1.25rem;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
        }
        .col,
        .info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          min-width: 0;
          flex: 1;
        }
        @container fitted-card (max-width: 150px) and (max-height: 169px) {
          .badge {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.375rem;
            padding: 0.5rem;
            text-align: center;
          }
        }
        @container fitted-card (min-width: 151px) and (max-height: 169px) {
          .strip {
            display: flex;
            align-items: center;
            gap: 0.625rem;
            padding: 0.625rem 0.75rem;
          }
        }
        @container fitted-card (max-width: 399px) and (min-height: 170px) {
          .tile {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 0.375rem;
            padding: 0.875rem;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .card {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            padding: 1.25rem;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Forecast> {
    get amountDisplay() {
      return (
        formatMoney(
          this.args.model?.projectedAmount?.amount,
          this.args.model?.projectedAmount?.currency?.code,
        ) || '—'
      );
    }
    <template>
      <article class='forecast-page'>
        <header class='fh'>
          <div>
            <p class='doc-kind'>Forecast</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
          <span class='amount'>{{this.amountDisplay}}</span>
        </header>
        <section class='panel'>
          <h2>Details</h2>
          <dl>
            {{#if @model.territory}}
              <dt>Territory</dt>
              <dd><@fields.territory @format='atom' /></dd>
            {{/if}}
            {{#if @model.calculatedAt}}
              <dt>Calculated</dt>
              <dd><@fields.calculatedAt /></dd>
            {{/if}}
          </dl>
        </section>
      </article>
      <style scoped>
        .forecast-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .fh {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1rem;
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
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .amount {
          font-size: 1.5rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
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
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.5rem 1.25rem;
          font-size: 0.875rem;
          align-items: center;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
        }
      </style>
    </template>
  };
}
