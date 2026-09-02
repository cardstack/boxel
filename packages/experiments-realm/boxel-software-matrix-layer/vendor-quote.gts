import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import TextAreaField from '@cardstack/base/text-area';
import BooleanField from '@cardstack/base/boolean';

import { LineItem } from './line-item';
import { Vendor } from './vendor';
import { VendorProfile } from './vendor-profile';
import { Rfq } from './rfq';
import { formatMoney, sumLineItems } from './money';
import { StatePill } from './components/state-pill';

function isPastDay(d?: Date | null): boolean {
  if (!d) {
    return false;
  }
  let now = new Date();
  let today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return day < today;
}

// A vendor's priced response to an RFQ, recorded by the BUYER (single-persona
// rule: vendors do not log in — the procurement manager transcribes inbound
// quotes from email/PDF). Lines reuse LineItem so quote totals and PO lines
// speak the same shape. `vendorProfile` is optional but recommended: linking
// it lets the comparison board surface the compliance gate; AwardRfqCommand
// enforces the same gate server-side regardless.
export class VendorQuote extends CardDef {
  static displayName = 'Vendor Quote';
  static headerColor = '#3e4e88';

  @field rfq = linksTo(() => Rfq, { searchable: true });
  @field vendor = linksTo(() => Vendor);
  @field vendorProfile = linksTo(() => VendorProfile);
  @field lineItems = containsMany(LineItem);
  @field leadTimeDays = contains(NumberField);
  @field validUntil = contains(DateField);
  @field notes = contains(TextAreaField);

  @field totalAmount = contains(NumberField, {
    computeVia: function (this: VendorQuote) {
      return sumLineItems(this.lineItems ?? []).total;
    },
  });

  @field isStale = contains(BooleanField, {
    computeVia: function (this: VendorQuote) {
      return isPastDay(this.validUntil);
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: VendorQuote) {
      let vendorName = this.vendor?.name?.trim();
      return vendorName ? `Quote — ${vendorName}` : 'Vendor Quote';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get totalLabel() {
      return formatMoney(this.args.model?.totalAmount ?? 0, 'USD');
    }
    get validityLabel() {
      let d = this.args.model?.validUntil;
      if (!d) {
        return 'no expiry set';
      }
      let label = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      return this.args.model?.isStale ? `expired ${label}` : `valid to ${label}`;
    }
    <template>
      <article class='quote'>
        <header class='head'>
          <div>
            <p class='kicker'>Vendor Quote</p>
            <h1>{{@model.title}}</h1>
            {{#if @model.rfq}}
              <p class='sub'>for <@fields.rfq @format='atom' /></p>
            {{/if}}
          </div>
          <div class='head-right'>
            <span class='total'>{{this.totalLabel}}</span>
            <StatePill
              @label={{this.validityLabel}}
              @hue={{if @model.isStale 'red' 'green'}}
              @dot={{true}}
            />
          </div>
        </header>

        <div class='grid'>
          <section class='panel span'>
            <h2>Quoted Lines</h2>
            <div class='lines'>
              {{#each @fields.lineItems as |Line|}}
                <Line />
              {{else}}
                <p class='empty'>No lines recorded.</p>
              {{/each}}
            </div>
          </section>

          <section class='panel'>
            <h2>Delivery</h2>
            <dl>
              <div><dt>Lead time</dt><dd>{{@model.leadTimeDays}} days</dd></div>
            </dl>
          </section>

          <section class='panel'>
            <h2>Vendor</h2>
            {{#if @model.vendor}}
              <@fields.vendor @format='atom' />
            {{/if}}
            {{#if @model.vendorProfile}}
              <div class='profile-link'>
                <@fields.vendorProfile @format='atom' />
              </div>
            {{/if}}
          </section>

          {{#if @model.notes}}
            <section class='panel span'>
              <h2>Notes</h2>
              <p class='notes'>{{@model.notes}}</p>
            </section>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .quote {
          container-type: inline-size;
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          padding-bottom: var(--boxel-sp);
          margin-bottom: var(--boxel-sp-lg);
        }
        .kicker {
          margin: 0;
          font-size: 0.6875rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: var(--boxel-sp-5xs) 0;
          font-family: var(--font-heading, inherit);
          font-size: 1.5rem;
        }
        .sub {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .head-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: var(--boxel-sp-5xs);
        }
        .total {
          font-size: 1.375rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        .panel.span {
          grid-column: 1 / -1;
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        dl {
          margin: 0;
        }
        dl > div {
          display: grid;
          grid-template-columns: 7rem 1fr;
          gap: var(--boxel-sp-xs);
        }
        dt {
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.8125rem;
        }
        dd {
          margin: 0;
          font-size: 0.875rem;
          font-variant-numeric: tabular-nums;
        }
        .lines {
          display: grid;
          gap: var(--boxel-sp-5xs);
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
          font-size: 0.875rem;
        }
        .notes {
          margin: 0;
          font-size: 0.875rem;
          white-space: pre-wrap;
        }
        .profile-link {
          margin-top: var(--boxel-sp-4xs);
        }
        @container (max-width: 560px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .head {
            flex-direction: column;
          }
          .head-right {
            align-items: flex-start;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get totalLabel() {
      return formatMoney(this.args.model?.totalAmount ?? 0, 'USD');
    }
    <template>
      <div class='row'>
        <span class='name'>{{@model.title}}</span>
        <span class='lead'>{{@model.leadTimeDays}}d lead</span>
        <span class='amount'>{{this.totalLabel}}</span>
        <StatePill
          @label={{if @model.isStale 'expired' 'valid'}}
          @hue={{if @model.isStale 'red' 'green'}}
          @dot={{true}}
        />
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 1fr auto auto auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lead {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
        .amount {
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          min-width: 5.5rem;
          text-align: right;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get totalLabel() {
      return formatMoney(this.args.model?.totalAmount ?? 0, 'USD');
    }
    <template>
      <span class='atom'>{{@model.title}} · {{this.totalLabel}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get totalLabel() {
      return formatMoney(this.args.model?.totalAmount ?? 0, 'USD');
    }
    <template>
      <div class='fit'>
        <span class='fit-name'>{{@model.title}}</span>
        <div class='fit-foot'>
          <span class='fit-total'>{{this.totalLabel}}</span>
          <span class='fit-lead'>{{@model.leadTimeDays}}d</span>
        </div>
      </div>
      <style scoped>
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          padding: var(--boxel-sp-xs);
          overflow: hidden;
        }
        .fit-name {
          font-weight: 600;
          font-size: 0.9375rem;
          line-height: 1.2;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .fit-foot {
          margin-top: auto;
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .fit-total {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .fit-lead {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container fitted-card (height <= 65px) {
          .fit {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-xs);
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
          .fit-foot {
            margin-top: 0;
            margin-left: auto;
            gap: var(--boxel-sp-xs);
          }
        }
      </style>
    </template>
  };
}
