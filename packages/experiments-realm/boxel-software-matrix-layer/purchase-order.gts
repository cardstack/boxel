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
import enumField from '@cardstack/base/enum';
import { realmURL } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Button, FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import { LineItem } from './line-item';
import { Vendor } from './vendor';
import { Rfq } from './rfq';
import { ProcurementBudget } from './procurement-budget';
import { PONumberField } from './po-number-field';
import { ApprovalChainField } from './approval-chain-field';
import { formatMoney, sumLineItems } from './money';
import { StatePill } from './components/state-pill';
import ApprovePurchaseOrderCommand from './commands/approve-purchase-order-command';
import { EditSectionNav } from './components/edit-section-nav';
import { stateColor, type StateColor } from './utils/index';

export const PO_STATUSES = [
  'draft',
  'pending-approval',
  'approved',
  'sent',
  'partially-received',
  'received',
  'closed',
  'rejected',
];

export const PO_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  'pending-approval': 'Pending Approval',
  approved: 'Approved',
  sent: 'Sent',
  'partially-received': 'Partially Received',
  received: 'Received',
  closed: 'Closed',
  rejected: 'Rejected',
};

export const PO_STATUS_COLORS: Record<string, StateColor> = {
  draft: stateColor('slate'),
  'pending-approval': stateColor('amber'),
  approved: stateColor('blue'),
  sent: stateColor('blue'),
  'partially-received': stateColor('amber'),
  received: stateColor('green'),
  closed: stateColor('slate'),
  rejected: stateColor('red'),
};

const STATUS_HUES: Record<
  string,
  'slate' | 'amber' | 'blue' | 'green' | 'red'
> = {
  draft: 'slate',
  'pending-approval': 'amber',
  approved: 'blue',
  sent: 'blue',
  'partially-received': 'amber',
  received: 'green',
  closed: 'slate',
  rejected: 'red',
};

export const POStatusField = enumField(StringField, {
  options: PO_STATUSES.map((value) => ({
    value,
    label: PO_STATUS_LABELS[value],
  })),
  displayName: 'PO Status',
});

// Threshold routing — the single most recognizable "real procurement"
// feature. The route is computed from the PO total at issue time and stored
// on the card (`approvalRoute`) so the applied policy stays auditable even
// if thresholds change later. Step ROLE labels are positional per route:
// the shared ApprovalStepField deliberately has no role field, so the roles
// live here in the module that owns the routing policy.
export const PO_APPROVAL_THRESHOLDS = {
  auto: 1_000, // below this: auto-approved
  manager: 10_000, // below this: one Manager step; at/above: Finance → VP
};

export type PoApprovalRoute = 'auto' | 'manager' | 'finance-vp';

export function poApprovalRouteFor(total: number): PoApprovalRoute {
  if (total < PO_APPROVAL_THRESHOLDS.auto) {
    return 'auto';
  }
  if (total < PO_APPROVAL_THRESHOLDS.manager) {
    return 'manager';
  }
  return 'finance-vp';
}

export const PO_ROUTE_STEP_ROLES: Record<PoApprovalRoute, string[]> = {
  auto: [],
  manager: ['Manager'],
  'finance-vp': ['Finance', 'VP'],
};

export const PO_ROUTE_LABELS: Record<PoApprovalRoute, string> = {
  auto: 'Auto (under $1k)',
  manager: 'Manager ($1k–$10k)',
  'finance-vp': 'Finance → VP ($10k+)',
};

// The binding order document. Once the approval chain completes, the PO's
// total is COMMITTED against its budget (commitment accounting) — approving
// and receiving are the only writers of those budget numbers, both via
// commands, never by hand. `poNumber` is stamped once at issue and never
// recomputed.
export class PurchaseOrder extends CardDef {
  static displayName = 'Purchase Order';
  static headerColor = '#3e4e88';

  @field poNumber = contains(PONumberField);
  @field rfq = linksTo(() => Rfq);
  @field vendor = linksTo(() => Vendor);
  @field lineItems = containsMany(LineItem);
  @field status = contains(POStatusField);
  @field approvalRoute = contains(StringField);
  @field approvalChain = contains(ApprovalChainField);
  @field budget = linksTo(() => ProcurementBudget);
  @field expectedDelivery = contains(DateField);
  // Per-line received-so-far, index-aligned with lineItems. Maintained only
  // by ReceiveGoodsCommand (partial receipts accumulate here) — never
  // hand-edited.
  @field receivedQuantities = containsMany(NumberField);

  @field totalAmount = contains(NumberField, {
    computeVia: function (this: PurchaseOrder) {
      return sumLineItems(this.lineItems ?? []).total;
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: PurchaseOrder) {
      return this.poNumber?.trim()?.length ? this.poNumber : 'Draft PO';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    @tracked busy = false;
    @tracked error: string | undefined;
    @tracked message: string | undefined;

    get statusHue() {
      return STATUS_HUES[this.args.model?.status ?? 'draft'] ?? 'slate';
    }
    get statusLabel() {
      return PO_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Draft';
    }
    get totalLabel() {
      return formatMoney(this.args.model?.totalAmount ?? 0, 'USD');
    }
    get routeLabel() {
      let route = this.args.model?.approvalRoute as PoApprovalRoute;
      return PO_ROUTE_LABELS[route] ?? '';
    }
    get canDecide() {
      let model = this.args.model;
      return (
        model?.status === 'pending-approval' &&
        model?.approvalChain?.status === 'in-progress'
      );
    }
    get deliveryLabel() {
      let d = this.args.model?.expectedDelivery;
      return d
        ? d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '—';
    }

    decide = async (decision: 'approved' | 'rejected') => {
      let model = this.args.model;
      if (!model) {
        return;
      }
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        this.error = 'Commands are unavailable in this mode';
        return;
      }
      this.error = undefined;
      this.message = undefined;
      this.busy = true;
      try {
        let result = await new ApprovePurchaseOrderCommand(
          commandContext,
        ).execute({
          purchaseOrder: model,
          decision,
        } as any);
        this.message = (result as any)?.message;
      } catch (error: any) {
        this.error = error?.message ?? String(error);
      } finally {
        this.busy = false;
      }
    };

    <template>
      <article class='po'>
        <header class='head'>
          <div>
            <p class='kicker'>Purchase Order</p>
            <h1><@fields.poNumber @format='embedded' /></h1>
            <p class='sub'>
              {{#if @model.vendor}}<@fields.vendor @format='atom' />{{/if}}
              · expected {{this.deliveryLabel}}</p>
          </div>
          <div class='head-right'>
            <StatePill
              @label={{this.statusLabel}}
              @hue={{this.statusHue}}
              @emphatic={{true}}
            />
            <span class='total'>{{this.totalLabel}}</span>
          </div>
        </header>

        {{#if this.error}}<div class='flash error'>{{this.error}}</div>{{/if}}
        {{#if this.message}}<div class='flash ok'>{{this.message}}</div>{{/if}}

        <div class='grid'>
          <section class='panel span'>
            <div class='panel-head'>
              <h2>Approval Chain</h2>
              {{#if this.routeLabel}}
                <StatePill @label={{this.routeLabel}} @hue='slate' @chrome={{true}} />
              {{/if}}
            </div>
            <@fields.approvalChain @format='embedded' />
            {{#if this.canDecide}}
              <div class='decide'>
                <Button
                  @kind='primary'
                  @size='small'
                  @disabled={{this.busy}}
                  {{on 'click' (fn this.decide 'approved')}}
                >Approve current step</Button>
                <Button
                  @kind='secondary-light'
                  @size='small'
                  @disabled={{this.busy}}
                  {{on 'click' (fn this.decide 'rejected')}}
                >Reject</Button>
              </div>
            {{/if}}
          </section>

          <section class='panel span'>
            <h2>Lines</h2>
            <div class='lines'>
              {{#each @fields.lineItems as |Line|}}
                <Line />
              {{else}}
                <p class='empty'>No lines.</p>
              {{/each}}
            </div>
            <div class='lines-total'>
              <span>Total</span>
              <span class='lines-total-num'>{{this.totalLabel}}</span>
            </div>
          </section>

          <section class='panel'>
            <h2>Budget</h2>
            {{#if @model.budget}}
              <@fields.budget @format='embedded' />
            {{else}}
              <p class='empty'>No budget linked — approving will not commit
                funds anywhere.</p>
            {{/if}}
          </section>

          <section class='panel'>
            <h2>Provenance</h2>
            {{#if @model.rfq}}
              <@fields.rfq @format='embedded' />
            {{else}}
              <p class='empty'>Direct PO (no RFQ).</p>
            {{/if}}
          </section>
        </div>
      </article>
      <style scoped>
        .po {
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
          margin-bottom: var(--boxel-sp);
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
          font-size: 1.625rem;
          line-height: 1.15;
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
        .flash {
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          margin-bottom: var(--boxel-sp);
          font-size: 0.875rem;
        }
        .flash.error {
          background: color-mix(
            in oklch,
            var(--state-red-fg, #b91c1c) 10%,
            transparent
          );
          color: var(--state-red-fg, #b91c1c);
        }
        .flash.ok {
          background: color-mix(
            in oklch,
            var(--state-green-fg, #15803d) 10%,
            transparent
          );
          color: var(--state-green-fg, #15803d);
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
        .panel-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: var(--boxel-sp);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .decide {
          margin-top: var(--boxel-sp-sm);
          display: flex;
          gap: var(--boxel-sp-xs);
        }
        .lines {
          display: grid;
          gap: var(--boxel-sp-5xs);
        }
        .lines-total {
          display: flex;
          justify-content: space-between;
          border-top: 2px solid var(--foreground, var(--boxel-dark));
          margin-top: var(--boxel-sp-xs);
          padding-top: var(--boxel-sp-xs);
          font-weight: 600;
        }
        .lines-total-num {
          font-variant-numeric: tabular-nums;
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.875rem;
          font-style: italic;
        }
        @container (max-width: 640px) {
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
      return PO_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Draft';
    }
    get totalLabel() {
      return formatMoney(this.args.model?.totalAmount ?? 0, 'USD');
    }
    <template>
      <div class='row'>
        <@fields.poNumber @format='atom' />
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
      <span class='atom'><@fields.poNumber @format='atom' /></span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get statusLabel() {
      return PO_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Draft';
    }
    get totalLabel() {
      return formatMoney(this.args.model?.totalAmount ?? 0, 'USD');
    }
    get deliveryLabel() {
      let d = this.args.model?.expectedDelivery;
      return d
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
    }
    get routeLabel() {
      return PO_ROUTE_LABELS[
        (this.args.model?.approvalRoute as PoApprovalRoute) ?? 'manager'
      ];
    }
    <template>
      <div class='fit'>
        <div class='fit-head'>
          <span class='fit-name'>{{@model.title}}</span>
          <span class='fit-status'>{{this.statusLabel}}</span>
        </div>
        <span class='fit-total'>{{this.totalLabel}}</span>
        <div class='fit-mid'>
          {{#if this.routeLabel}}<span class='fit-route'>{{this.routeLabel}}</span>{{/if}}
          {{#if this.deliveryLabel}}<span class='fit-due'>due
              {{this.deliveryLabel}}</span>{{/if}}
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
        .fit-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
        }
        .fit-mid {
          display: none;
          margin-top: auto;
          flex-direction: column;
          gap: 2px;
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-route {
          padding: 1px 8px;
          border-radius: 999px;
          background: color-mix(
            in oklch,
            var(--procurement-ink, var(--primary, var(--boxel-dark))) 9%,
            transparent
          );
          color: var(--procurement-ink, var(--primary, var(--boxel-dark)));
          width: fit-content;
        }
        @container fitted-card (height > 120px) {
          .fit-mid {
            display: flex;
          }
        }
        .fit-name {
          font-weight: 700;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.9375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-total {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-size: 1.0625rem;
        }
        .fit-status {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        @container fitted-card (height <= 65px) {
          .fit {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-sm);
          }
          .fit-head {
            gap: var(--boxel-sp-sm);
          }
          .fit-total {
            margin-left: auto;
          }
          .fit-mid {
            display: none;
          }
        }
      </style>
    </template>
  };

  // Grouped by how a PO is actually assembled (which order is this → what's
  // on it → who signs off and against what money → when does it arrive and
  // what's been received), not schema order. Four sections, so this form
  // gets the EditSectionNav rail (edit-card Rule 0b). totalAmount and title
  // are computed (computeVia) and deliberately excluded.
  static edit = class Edit extends Component<typeof this> {
    // Left section nav: clicking anchors that section to the top of the
    // form's own scroller (the root, per edit-card Rule 1 — never a nested
    // scroller). Scoped through the event's own root so several open edit
    // panels never cross-scroll each other.
    @tracked activeSection = 'identity';

    sections = [
      { id: 'identity', label: 'Order Identity' },
      { id: 'lines', label: 'Line Items' },
      { id: 'approval', label: 'Approval & Budget' },
      { id: 'delivery', label: 'Delivery & Receiving' },
    ];

    goTo = (id: string, event: Event) => {
      this.activeSection = id;
      let root = (event.currentTarget as HTMLElement).closest('.po-edit');
      root
        ?.querySelector(`[data-sect='${id}']`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    <template>
      <div class='po-edit'>
        {{! the container element cannot be restyled by its own query
            (edit-card Rule 1 corollary) — the responsive grid lives on
            this inner wrapper instead }}
        <div class='edit-body'>
          <EditSectionNav
            @sections={{this.sections}}
            @activeId={{this.activeSection}}
            @onSelect={{this.goTo}}
            class='sect-nav'
          />
          <div class='sects'>
            <section
              class='sect {{if (eq this.activeSection "identity") "focused"}}'
              data-sect='identity'
            >
              <h3>Order Identity
                <span class='sect-hint'>the PO number is stamped once at issue
                  and never recomputed</span></h3>
              <div class='row identity'>
                <FieldContainer @label='PO number' @vertical={{true}}>
                  <@fields.poNumber />
                </FieldContainer>
                <FieldContainer @label='Status' @vertical={{true}}>
                  <@fields.status />
                </FieldContainer>
                <FieldContainer @label='Vendor' @vertical={{true}}>
                  <@fields.vendor />
                </FieldContainer>
              </div>
              <FieldContainer @label='Source RFQ (optional)' @vertical={{true}}>
                <@fields.rfq />
              </FieldContainer>
            </section>

            <section
              class='sect lines
                {{if (eq this.activeSection "lines") "focused"}}'
              data-sect='lines'
            >
              <h3>Line Items
                <span class='sect-hint'>the committed total is computed from
                  these lines</span></h3>
              <FieldContainer
                @label='Lines (description, qty, unit price)'
                @vertical={{true}}
              >
                <@fields.lineItems />
              </FieldContainer>
            </section>

            <section
              class='sect {{if (eq this.activeSection "approval") "focused"}}'
              data-sect='approval'
            >
              <h3>Approval &amp; Budget
                <span class='sect-hint'>route and chain are normally set by the
                  approval command — edit only to correct mistakes</span></h3>
              <div class='row two'>
                <FieldContainer @label='Approval route' @vertical={{true}}>
                  <@fields.approvalRoute />
                </FieldContainer>
                <FieldContainer @label='Budget to commit against' @vertical={{true}}>
                  <@fields.budget />
                </FieldContainer>
              </div>
              <FieldContainer @label='Approval chain' @vertical={{true}}>
                <@fields.approvalChain />
              </FieldContainer>
            </section>

            <section
              class='sect {{if (eq this.activeSection "delivery") "focused"}}'
              data-sect='delivery'
            >
              <h3>Delivery &amp; Receiving
                <span class='sect-hint'>received quantities accumulate via the
                  Receive Goods command, index-aligned with the lines</span></h3>
              <div class='row two'>
                <FieldContainer @label='Expected delivery' @vertical={{true}}>
                  <@fields.expectedDelivery />
                </FieldContainer>
              </div>
              <FieldContainer
                @label='Received so far (per line)'
                @vertical={{true}}
              >
                <@fields.receivedQuantities />
              </FieldContainer>
            </section>
          </div>
        </div>
      </div>
      <style scoped>
        .po-edit {
          container-type: inline-size;
          container-name: edit;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          /* the procurement family's brand ink, declared ONCE — a linked
             Theme overrides via --procurement-ink */
          --po-ink: var(--procurement-ink, #27306b);
          --po-ink-fg: var(--procurement-ink-fg, var(--boxel-light));
        }
        .edit-body {
          display: grid;
          grid-template-columns: 9.5rem minmax(0, 1fr);
          align-items: start;
          gap: var(--boxel-sp);
        }
        /* the root is the scroller, so sticky pins the nav to its top */
        .sect-nav {
          position: sticky;
          top: 0;
          /* hand the family ink pair to the rail's published knobs */
          --edit-section-nav-ink: var(--po-ink);
          --edit-section-nav-ink-fg: var(--po-ink-fg);
        }
        .sects {
          display: grid;
          gap: var(--boxel-sp);
          min-width: 0;
        }
        .sect {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-sm);
          transition:
            outline-color 160ms ease,
            box-shadow 160ms ease;
          outline: 2px solid transparent;
          outline-offset: 2px;
        }
        /* the section the rail points at mirrors the rail's active state:
           same pinned brand ink, diluted for the halo */
        .sect.focused {
          outline-color: var(--po-ink);
          box-shadow: 0 0 0 4px
            color-mix(in oklch, var(--po-ink) 12%, transparent);
        }
        .sect.lines {
          border-left: 3px solid var(--po-ink);
        }
        h3 {
          margin: 0;
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .sect-hint {
          text-transform: none;
          letter-spacing: normal;
          font-size: 0.75rem;
          font-weight: 400;
          font-style: italic;
        }
        .row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--boxel-sp-sm);
          align-items: start;
        }
        .row.two {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .identity {
          grid-template-columns: 1.4fr 1fr 1.4fr;
        }
        @container edit (width < 640px) {
          .row,
          .row.two,
          .identity {
            grid-template-columns: 1fr;
          }
          /* narrow panel: nav becomes a horizontal chip row above the form */
          .edit-body {
            grid-template-columns: 1fr;
          }
          /* narrow: the rail flips horizontal (consumer's scope attribute
             rides ...attributes onto the component root, so these apply) */
          .sect-nav {
            position: static;
            flex-direction: row;
            flex-wrap: wrap;
          }
          .sect-nav::before {
            display: none;
          }
        }
      </style>
    </template>
  };
}
