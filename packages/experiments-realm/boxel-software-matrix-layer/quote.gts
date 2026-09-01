import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
  NumberField,
  StringField,
} from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import { Deal } from './deal';
import { LineItem } from './line-item';
import { Proposal } from './proposal';
import {
  formatMoney,
  lineTotal,
  sumLineItems,
} from './money';

// Quote — a priced proposal, not yet binding. Versioned: each negotiation
// round creates a NEW Quote with `supersedes` pointing at the previous one,
// which stays immutable — mirrors the "one Order links to many immutable
// Payment records" pattern already proven on this realm (and reused again
// by Sole Vault's own Payment). Line items reuse the realm's existing
// `LineItem` FieldDef (same shape Order/Invoice already use) rather than a
// new type — a Quote's line items are a snapshot of description/qty/price
// at negotiation time, which `LineItem` already models correctly; `Price`
// cards are the separate catalog/lookup entities used to POPULATE these
// line items when authoring a quote, not what the line item stores.

const QuoteStatusField = enumField(StringField, {
  options: ['draft', 'sent', 'under-review', 'won', 'lost', 'expired'],
  displayName: 'Quote Status',
});

export class Quote extends CardDef {
  static displayName = 'Quote';
  static icon = FileTextIcon;

  @field version = contains(NumberField);
  @field status = contains(QuoteStatusField);
  @field supersedes = linksTo(() => Quote);
  @field deal = linksTo(Deal);
  @field proposal = linksTo(Proposal);
  @field lineItems = containsMany(LineItem);

  @field total = contains(NumberField, {
    computeVia: function (this: Quote) {
      return sumLineItems(this.lineItems);
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Quote) {
      let dealName = this.deal?.cardTitle;
      let v = this.version ? `v${this.version}` : undefined;
      if (!dealName) return `Untitled ${this.constructor.displayName}`;
      return v ? `${dealName} — Quote ${v}` : `${dealName} — Quote`;
    },
  });

  static atom = class Atom extends Component<typeof Quote> {
    <template>
      <span class='quote-atom'>
        <FileTextIcon class='qa-icon' />
        <span class='qa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .quote-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .qa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .qa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Quote> {
    get totalDisplay() {
      let currency =
        this.args.model?.lineItems?.[0]?.unitPrice?.currency?.code;
      return formatMoney(this.args.model?.total, currency);
    }
    <template>
      <div class='quote-row'>
        <FileTextIcon class='icon' />
        <div class='info'>
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.status}}
            <span class='status status-{{@model.status}}'>{{@model.status}}</span>
          {{/if}}
        </div>
        {{#if this.totalDisplay}}
          <span class='value'>{{this.totalDisplay}}</span>
        {{/if}}
      </div>
      <style scoped>
        .quote-row {
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
        .status {
          align-self: flex-start;
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          width: fit-content;
        }
        .status-won {
          background: #d1fae5;
          color: #065f46;
        }
        .status-lost,
        .status-expired {
          background: #fee2e2;
          color: #991b1b;
        }
        .value {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Quote> {
    get totalDisplay() {
      let currency =
        this.args.model?.lineItems?.[0]?.unitPrice?.currency?.code;
      return formatMoney(this.args.model?.total, currency) || '—';
    }
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <FileTextIcon class='doc-icon' />
          <span class='figure'>{{this.totalDisplay}}</span>
        </div>
        <div class='fmt strip'>
          <FileTextIcon class='doc-icon' />
          <div class='info'>
            <span class='name'>{{@model.cardTitle}}</span>
            {{#if @model.status}}
              <span
                class='status status-{{@model.status}}'
              >{{@model.status}}</span>
            {{/if}}
          </div>
          <span class='figure'>{{this.totalDisplay}}</span>
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
        }
        .figure {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-size: 0.875rem;
          white-space: nowrap;
        }
        .status {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .status-won {
          background: #d1fae5;
          color: #065f46;
        }
        .status-lost,
        .status-expired {
          background: #fee2e2;
          color: #991b1b;
        }
        .info {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
          flex: 1;
        }
        @container fitted-card (max-width: 150px) and (max-height: 169px) {
          .badge {
            display: flex;
            flex-direction: column;
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
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Quote> {
    get rows() {
      return (this.args.model?.lineItems ?? []).map((item) => ({
        description: item?.description || '—',
        quantity: item?.quantity ?? 0,
        unit: formatMoney(
          item?.unitPrice?.amount,
          item?.unitPrice?.currency?.code,
        ),
        total: formatMoney(lineTotal(item), item?.unitPrice?.currency?.code),
      }));
    }
    get totalDisplay() {
      let currency =
        this.args.model?.lineItems?.[0]?.unitPrice?.currency?.code;
      return formatMoney(this.args.model?.total, currency) || '—';
    }
    <template>
      <article class='quote-doc'>
        <header class='doc-head'>
          <div>
            <p class='doc-kind'>Quote</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
          {{#if @model.status}}
            <span class='status status-{{@model.status}}'>{{@model.status}}</span>
          {{/if}}
        </header>

        {{#if @model.supersedes}}
          <p class='superseded-note'>Supersedes
            <@fields.supersedes @format='atom' /></p>
        {{/if}}

        <section class='items'>
          {{#if this.rows.length}}
            <table>
              <thead>
                <tr>
                  <th class='t-desc'>Item</th>
                  <th class='t-num'>Qty</th>
                  <th class='t-num'>Unit</th>
                  <th class='t-num'>Amount</th>
                </tr>
              </thead>
              <tbody>
                {{#each this.rows as |row|}}
                  <tr>
                    <td class='t-desc'>{{row.description}}</td>
                    <td class='t-num'>{{row.quantity}}</td>
                    <td class='t-num'>{{row.unit}}</td>
                    <td class='t-num t-strong'>{{row.total}}</td>
                  </tr>
                {{/each}}
              </tbody>
              <tfoot>
                <tr>
                  <td class='t-desc' colspan='3'>Total</td>
                  <td class='t-num t-total'>{{this.totalDisplay}}</td>
                </tr>
              </tfoot>
            </table>
          {{else}}
            <p class='empty'>No line items yet</p>
          {{/if}}
        </section>
      </article>
      <style scoped>
        .quote-doc {
          max-width: 46rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .doc-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1rem;
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
          font-size: 1.75rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .status {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          padding: 0.1875rem 0.625rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .status-won {
          background: #d1fae5;
          color: #065f46;
        }
        .status-lost,
        .status-expired {
          background: #fee2e2;
          color: #991b1b;
        }
        .superseded-note {
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
          margin: 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
        }
        th {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, #6b7280);
          padding: 0 0.5rem 0.5rem;
          border-bottom: 1px solid var(--border, #e5e7eb);
        }
        td {
          padding: 0.625rem 0.5rem;
          border-bottom: 1px solid var(--border, #e5e7eb);
        }
        .t-desc {
          text-align: left;
        }
        .t-num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .t-strong {
          font-weight: 600;
        }
        tfoot td {
          border-bottom: none;
          border-top: 2px solid var(--foreground, #111111);
          padding-top: 0.75rem;
          font-weight: 700;
        }
        .t-total {
          font-size: 1.125rem;
        }
        .empty {
          margin: 0;
          padding: 1.5rem;
          text-align: center;
          border: 1px dashed var(--border, #e5e7eb);
          border-radius: 0.5rem;
          color: var(--muted-foreground, #6b7280);
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };
}
