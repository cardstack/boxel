import {
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import enumField from '@cardstack/base/enum';
import ShieldIcon from '@cardstack/boxel-icons/shield';
import { htmlSafe } from '@ember/template';

import { PersonBase } from './person-base';
import { stateColor, stateColorOf, type StateColor } from './utils/index';

export const CONTRACTOR_STATUSES = ['active', 'inactive', 'terminated'];

export const CONTRACTOR_STATUS_COLORS: Record<string, StateColor> = {
  active: stateColor('green'),
  inactive: stateColor('amber'),
  terminated: stateColor('red'),
};

export const ContractorStatusField = enumField(StringField, {
  options: CONTRACTOR_STATUSES.map((status) => ({
    value: status,
    label: status,
  })),
  displayName: 'Contract Status',
});

export const InvoiceFrequencyOptions = ['monthly', 'quarterly', 'annually'];

export const InvoiceFrequencyField = enumField(StringField, {
  options: InvoiceFrequencyOptions.map((freq) => ({
    value: freq,
    label: freq,
  })),
  displayName: 'Invoice Frequency',
});

export class Contractor extends PersonBase {
  static displayName = 'Contractor';
  static icon = ShieldIcon;

  @field contractStatus = contains(ContractorStatusField);
  @field billableRate = contains(NumberField, {
    description: 'Hourly or day rate in dollars',
  });
  @field vatId = contains(StringField, {
    description: 'VAT ID for invoicing',
  });
  @field invoiceFrequency = contains(InvoiceFrequencyField);

  @field title = contains(StringField, {
    computeVia: function (this: Contractor) {
      return this.name?.trim() || 'Unnamed Contractor';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(
        CONTRACTOR_STATUS_COLORS,
        this.args.model?.contractStatus,
      );
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    get rateLabel(): string | undefined {
      let rate = this.args.model?.billableRate;
      if (rate == null) {
        return undefined;
      }
      return `$${rate}/hr`;
    }

    <template>
      <article class='contractor-isolated'>
        <header class='hero'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='avatar avatar-photo'
              src={{@model.photo.resolvedUrl}}
              alt=''
            />
          {{else}}
            <span class='avatar'>{{@model.initials}}</span>
          {{/if}}
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>Contractor</p>
            <div class='pill-row'>
              {{#if @model.contractStatus}}
                <span class='pill' style={{this.statusPillStyle}}>
                  <span class='pill-dot'></span>{{@model.contractStatus}}
                </span>
              {{/if}}
              {{#if this.rateLabel}}
                <span class='pill neutral'>{{this.rateLabel}}</span>
              {{/if}}
            </div>
          </div>
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Contact</h2>
            <dl class='facts'>
              <dt>Email</dt>
              <dd>{{if @model.email @model.email '—'}}</dd>
              <dt>Phone</dt>
              <dd>{{if @model.phone @model.phone '—'}}</dd>
            </dl>

            <h2 class='panel-title spaced'>Rate & Terms</h2>
            <dl class='facts'>
              <dt>Billable rate</dt>
              <dd>{{if this.rateLabel this.rateLabel '—'}}</dd>
              <dt>Invoice frequency</dt>
              <dd>{{if
                  @model.invoiceFrequency
                  @model.invoiceFrequency
                  '—'
                }}</dd>
            </dl>
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Contract</h2>
            <dl class='facts stacked'>
              <dt>Status</dt>
              <dd>{{if @model.contractStatus @model.contractStatus '—'}}</dd>
              <dt>VAT ID</dt>
              <dd>{{if @model.vatId @model.vatId '—'}}</dd>
            </dl>
          </aside>
        </div>
      </article>
      <style scoped>
        .contractor-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --contractor-id: var(--primary, var(--boxel-highlight));
          --contractor-strong: color-mix(
            in oklch,
            var(--contractor-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .avatar {
          flex: none;
          width: 3.25rem;
          height: 3.25rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          background: var(--contractor-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-photo {
          object-fit: cover;
        }
        .hero {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .hero-text {
          flex: 1;
          min-width: 0;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.2;
          overflow-wrap: anywhere;
          font-family: var(--font-heading, inherit);
        }
        .byline {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .pill-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-5xs);
          margin-top: var(--boxel-sp-xs);
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.18em 0.5em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .pill.neutral {
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .body {
          display: grid;
          grid-template-columns: 1fr 17rem;
          flex: 1;
          min-height: 0;
          align-content: start;
        }
        .main {
          padding: var(--boxel-sp-lg);
          min-width: 0;
        }
        .side {
          padding: var(--boxel-sp-lg);
          border-left: 1px solid var(--border, var(--boxel-200));
          background: var(--muted, var(--boxel-100));
        }
        .panel-title {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
        }
        .panel-title.spaced {
          margin-top: var(--boxel-sp-lg);
        }
        .facts {
          margin: 0;
          display: grid;
          grid-template-columns: 9rem 1fr;
        }
        .facts.stacked {
          grid-template-columns: 1fr;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
          padding: 0.45rem var(--boxel-sp-xs) 0.45rem 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .facts.stacked dt {
          border-bottom: 0;
          padding-bottom: 0;
        }
        .facts dd {
          margin: 0;
          padding: 0.45rem 0;
          font-size: var(--boxel-font-size-sm);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          overflow-wrap: anywhere;
        }
        .facts.stacked dd {
          padding-top: 0.1rem;
        }
        @container iso (max-width: 40rem) {
          .body {
            grid-template-columns: 1fr;
          }
          .side {
            border-left: 0;
            border-top: 1px solid var(--border, var(--boxel-200));
          }
          .hero {
            flex-wrap: wrap;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get statusStyle() {
      let c = stateColorOf(
        CONTRACTOR_STATUS_COLORS,
        this.args.model?.contractStatus,
      );
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <div class='contractor-embedded'>
        {{#if @model.photo.resolvedUrl}}
          <img class='ce-avatar' src={{@model.photo.resolvedUrl}} alt='' />
        {{else}}
          <span class='ce-avatar ce-initials'>{{@model.initials}}</span>
        {{/if}}
        <div class='ce-main'>
          <span class='ce-name'>{{if @model.name @model.name 'Unnamed'}}</span>
        </div>
        <div class='ce-side'>
          {{#if @model.contractStatus}}
            <span
              class='ce-status'
              style={{this.statusStyle}}
            >{{@model.contractStatus}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .contractor-embedded {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .ce-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .ce-initials {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.6875rem;
          font-weight: 700;
        }
        .ce-main {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
          min-width: 0;
          flex: 1;
        }
        .ce-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ce-side {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.1875rem;
          flex-shrink: 0;
        }
        .ce-status {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='contractor-atom'>
        <span class='contractor-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .contractor-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .contractor-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(
        CONTRACTOR_STATUS_COLORS,
        this.args.model?.contractStatus,
      );
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    get rateLabel(): string | undefined {
      let rate = this.args.model?.billableRate;
      if (rate == null) {
        return undefined;
      }
      return `$${rate}/hr`;
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='avatar avatar-photo'
              src={{@model.photo.resolvedUrl}}
              alt=''
            />
          {{else}}
            <span class='avatar'>{{@model.initials}}</span>
          {{/if}}
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
          </div>
          {{#if @model.contractStatus}}
            <span class='fit-pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{@model.contractStatus}}
            </span>
          {{/if}}
        </div>

        <div class='fit-mid'>
          {{#if this.rateLabel}}
            <span class='money'>{{this.rateLabel}}</span>
          {{/if}}
        </div>

        <dl class='fit-add'>
          {{#if @model.invoiceFrequency}}
            <div><dt>Invoice</dt><dd>{{@model.invoiceFrequency}}</dd></div>
          {{/if}}
          {{#if @model.vatId}}
            <div><dt>VAT</dt><dd>{{@model.vatId}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --contractor-id: var(--primary, var(--boxel-highlight));
          --contractor-strong: color-mix(
            in oklch,
            var(--contractor-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        .avatar {
          flex: none;
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: var(--fit-small);
          font-weight: 700;
          background: var(--contractor-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-photo {
          object-fit: cover;
        }
        .fit > * {
          min-height: 0;
          overflow: hidden;
        }
        .fit-top {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: 0.4rem;
          flex-wrap: wrap;
          overflow: visible;
        }
        .fit-head {
          flex: 1;
          min-width: 0;
        }
        .fit-name {
          margin: 0;
          font-size: var(--fit-name);
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fit-pill {
          flex: none;
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: var(--fit-small);
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .pill-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .fit-mid {
          flex: none;
          display: none;
          flex-direction: column;
          gap: 1px;
        }
        .money {
          font-size: calc(var(--fit-name) * 1.15);
          font-weight: 800;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .fit-add {
          display: none;
          margin: 0;
          margin-top: auto;
          padding-top: 0.3rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
          grid-template-columns: 1fr 1fr;
          gap: 0.05rem 0.5rem;
        }
        .fit-add > div {
          display: flex;
          gap: 0.25rem;
          min-width: 0;
        }
        .fit-add dt {
          flex: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-add dd {
          margin: 0;
          font-size: var(--fit-small);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        @container fitted-card (height > 80px) {
          .fit-mid {
            display: flex;
          }
        }
        @container fitted-card (width > 240px) {
          .fit-mid {
            display: flex;
          }
        }
        @container fitted-card (height > 130px) and (width >= 170px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr;
          }
        }
        @container fitted-card (width > 340px) and (height > 130px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
        }
        @container fitted-card (height <= 90px) {
          .fit-top {
            align-items: center;
            flex-wrap: nowrap;
          }
          .fit-pill {
            align-self: center;
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
      </style>
    </template>
  };
}
