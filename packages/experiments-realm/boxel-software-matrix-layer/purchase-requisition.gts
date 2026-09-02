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
import enumField from '@cardstack/base/enum';

import { LineItem } from './line-item';
import { ProcurementBudget } from './procurement-budget';
import { formatMoney, sumLineItems } from './money';
import { StatePill } from './components/state-pill';
import { stateColor, type StateColor } from './utils/index';

export const REQUISITION_STATUSES = [
  'draft',
  'submitted',
  'converted-to-rfq',
  'rejected',
];

export const REQUISITION_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  'converted-to-rfq': 'Converted to RFQ',
  rejected: 'Rejected',
};

export const REQUISITION_STATUS_COLORS: Record<string, StateColor> = {
  draft: stateColor('slate'),
  submitted: stateColor('amber'),
  'converted-to-rfq': stateColor('green'),
  rejected: stateColor('red'),
};

const STATUS_HUES: Record<string, 'slate' | 'amber' | 'green' | 'red'> = {
  draft: 'slate',
  submitted: 'amber',
  'converted-to-rfq': 'green',
  rejected: 'red',
};

export const RequisitionStatusField = enumField(StringField, {
  options: REQUISITION_STATUSES.map((value) => ({
    value,
    label: REQUISITION_STATUS_LABELS[value],
  })),
  displayName: 'Requisition Status',
});

// The internal "I need to buy X" request that starts the Procure-to-Pay
// audit trail. No vendor is involved yet: a requisition names what is
// needed, by when, against which budget, and why — the RFQ that follows
// copies its line items. Single-persona: the procurement manager records
// requisitions on behalf of requesters.
export class PurchaseRequisition extends CardDef {
  static displayName = 'Purchase Requisition';
  static headerColor = '#3e4e88';

  @field requester = contains(StringField);
  @field department = contains(StringField);
  @field neededBy = contains(DateField);
  @field lineItems = containsMany(LineItem);
  @field justification = contains(TextAreaField);
  @field status = contains(RequisitionStatusField);
  @field budget = linksTo(() => ProcurementBudget);

  @field estimatedTotal = contains(NumberField, {
    computeVia: function (this: PurchaseRequisition) {
      return sumLineItems(this.lineItems ?? []).total;
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: PurchaseRequisition) {
      let first = this.lineItems?.[0]?.description?.trim();
      if (first) {
        let more = (this.lineItems?.length ?? 0) - 1;
        return more > 0 ? `${first} +${more} more` : first;
      }
      return this.requester?.trim()
        ? `Requisition — ${this.requester}`
        : 'Untitled Requisition';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get statusHue() {
      return STATUS_HUES[this.args.model?.status ?? 'draft'] ?? 'slate';
    }
    get statusLabel() {
      return (
        REQUISITION_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Draft'
      );
    }
    get totalLabel() {
      return formatMoney(this.args.model?.estimatedTotal ?? 0, 'USD');
    }
    get neededByLabel() {
      let d = this.args.model?.neededBy;
      return d
        ? d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '—';
    }
    <template>
      <article class='pr'>
        <header class='head'>
          <div>
            <p class='kicker'>Purchase Requisition</p>
            <h1>{{@model.title}}</h1>
            <p class='sub'>{{@model.requester}} · {{@model.department}}</p>
          </div>
          <div class='head-right'>
            <StatePill
              @label={{this.statusLabel}}
              @hue={{this.statusHue}}
              @emphatic={{true}}
            />
            <span class='total'>{{this.totalLabel}}</span>
            <span class='total-label'>estimated</span>
          </div>
        </header>

        <div class='grid'>
          <section class='panel span'>
            <h2>Requested Items</h2>
            <div class='lines'>
              {{#each @fields.lineItems as |Line|}}
                <Line />
              {{else}}
                <p class='empty'>No items added yet.</p>
              {{/each}}
            </div>
          </section>

          <section class='panel'>
            <h2>Timeline</h2>
            <dl>
              <div><dt>Needed by</dt><dd>{{this.neededByLabel}}</dd></div>
            </dl>
          </section>

          <section class='panel'>
            <h2>Budget</h2>
            {{#if @model.budget}}
              <@fields.budget @format='atom' />
            {{else}}
              <p class='empty'>No budget linked.</p>
            {{/if}}
          </section>

          {{#if @model.justification}}
            <section class='panel span'>
              <h2>Justification</h2>
              <p class='just'>{{@model.justification}}</p>
            </section>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .pr {
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
          line-height: 1.2;
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
          font-size: 1.25rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .total-label {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          text-transform: uppercase;
          letter-spacing: 0.08em;
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
        }
        .lines {
          display: grid;
          gap: var(--boxel-sp-5xs);
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.875rem;
          font-style: italic;
        }
        .just {
          margin: 0;
          font-size: 0.875rem;
          white-space: pre-wrap;
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
    get statusHue() {
      return STATUS_HUES[this.args.model?.status ?? 'draft'] ?? 'slate';
    }
    get statusLabel() {
      return (
        REQUISITION_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Draft'
      );
    }
    get totalLabel() {
      return formatMoney(this.args.model?.estimatedTotal ?? 0, 'USD');
    }
    <template>
      <div class='row'>
        <div class='who'>
          <span class='name'>{{@model.title}}</span>
          <span class='meta'>{{@model.requester}} ·
            {{@model.department}}</span>
        </div>
        <span class='amount'>{{this.totalLabel}}</span>
        <StatePill @label={{this.statusLabel}} @hue={{this.statusHue}} />
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .who {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
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
    <template>
      <span class='atom'>{{@model.title}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get statusLabel() {
      return (
        REQUISITION_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Draft'
      );
    }
    get totalLabel() {
      return formatMoney(this.args.model?.estimatedTotal ?? 0, 'USD');
    }
    get itemCount() {
      return (this.args.model?.lineItems ?? []).length;
    }
    <template>
      <div class='fit'>
        <span class='fit-name'>{{@model.title}}</span>
        <span class='fit-sub'>{{@model.requester}} · {{this.itemCount}}
          items</span>
        <div class='fit-foot'>
          <span class='fit-total'>{{this.totalLabel}}</span>
          <span class='fit-status'>{{this.statusLabel}}</span>
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
        .fit-sub {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-foot {
          margin-top: auto;
          display: none;
          justify-content: space-between;
          align-items: baseline;
          font-size: 0.8125rem;
        }
        .fit-total {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .fit-status {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container fitted-card (height > 110px) {
          .fit-foot {
            display: flex;
          }
        }
        @container fitted-card (height <= 65px) {
          .fit {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-xs);
          }
          .fit-sub {
            display: none;
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
      </style>
    </template>
  };
}
