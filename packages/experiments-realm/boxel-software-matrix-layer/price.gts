import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import TagIcon from '@cardstack/boxel-icons/tag';
import { Plan } from './plan';
import { Service } from './service';
import { formatMoney } from './money';

// Price — a specific amount + currency + billing interval for a Plan or a
// Service. Kept separate from both so a Plan can carry monthly AND annual
// price points without duplicating the Plan itself. Links to exactly one of
// `plan`/`service` — never both, never neither; enforced at the command
// layer (Convert Quote to Invoice), not the schema, matching this realm's
// existing convention of guarding invariants in commands rather than field
// validators.

const BillingIntervalField = enumField(StringField, {
  options: ['one-time', 'monthly', 'annual'],
  displayName: 'Billing Interval',
});

export class Price extends CardDef {
  static displayName = 'Price';
  static icon = TagIcon;

  @field amount = contains(AmountWithCurrency);
  @field billingInterval = contains(BillingIntervalField);
  @field plan = linksTo(Plan);
  @field service = linksTo(Service);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Price) {
      let amt = formatMoney(
        this.amount?.amount,
        this.amount?.currency?.code,
      );
      let subject = this.plan?.cardTitle ?? this.service?.cardTitle;
      if (!amt) return `Untitled ${this.constructor.displayName}`;
      return subject ? `${amt} — ${subject}` : amt;
    },
  });

  static atom = class Atom extends Component<typeof Price> {
    <template>
      <span class='price-atom'>
        <TagIcon class='pa-icon' />
        <span class='pa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .price-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .pa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .pa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Price> {
    get amountDisplay() {
      return formatMoney(
        this.args.model?.amount?.amount,
        this.args.model?.amount?.currency?.code,
      );
    }
    <template>
      <div class='price-row'>
        <TagIcon class='icon' />
        <span class='figure'>{{this.amountDisplay}}</span>
        {{#if @model.billingInterval}}
          <span class='chip'>{{@model.billingInterval}}</span>
        {{/if}}
      </div>
      <style scoped>
        .price-row {
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
        .figure {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .chip {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Price> {
    get amountDisplay() {
      return (
        formatMoney(
          this.args.model?.amount?.amount,
          this.args.model?.amount?.currency?.code,
        ) || '—'
      );
    }
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <TagIcon class='doc-icon' />
          <span class='figure'>{{this.amountDisplay}}</span>
        </div>
        <div class='fmt strip'>
          <TagIcon class='doc-icon' />
          <span class='figure'>{{this.amountDisplay}}</span>
          {{#if @model.billingInterval}}
            <span class='chip'>{{@model.billingInterval}}</span>
          {{/if}}
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
          align-items: center;
          gap: 0.5rem;
        }
        .doc-icon {
          width: 18px;
          height: 18px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .figure {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-size: 0.9375rem;
          white-space: nowrap;
        }
        .chip {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        @container fitted-card (max-width: 150px) and (max-height: 169px) {
          .badge {
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 0.5rem;
            text-align: center;
          }
        }
        @container fitted-card (min-width: 151px) {
          .strip {
            display: flex;
            padding: 0.625rem 0.75rem;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Price> {
    get amountDisplay() {
      return (
        formatMoney(
          this.args.model?.amount?.amount,
          this.args.model?.amount?.currency?.code,
        ) || '—'
      );
    }
    <template>
      <article class='price-page'>
        <header class='ph'>
          <p class='doc-kind'>Price</p>
          <h1>{{this.amountDisplay}}</h1>
          {{#if @model.billingInterval}}
            <span class='chip'>{{@model.billingInterval}}</span>
          {{/if}}
        </header>
        {{#if @model.plan}}
          <div class='subject'><@fields.plan @format='atom' /></div>
        {{/if}}
        {{#if @model.service}}
          <div class='subject'><@fields.service @format='atom' /></div>
        {{/if}}
      </article>
      <style scoped>
        .price-page {
          max-width: 32rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .ph {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .doc-kind {
          margin: 0;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 2rem;
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
        }
        .chip {
          align-self: flex-start;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          padding: 0.1875rem 0.625rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .subject {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
        }
      </style>
    </template>
  };
}
