import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
import { Button, BoxelInput } from '@cardstack/boxel-ui/components';

import { StatePill } from './state-pill';
import { MoneyDisplay } from './money-display';
import {
  matchLines,
  openVarianceCount,
  PRICE_TOLERANCE_PCT,
  PRICE_TOLERANCE_ABS,
  type LineMatch,
} from '../three-way-match';
import ResolveVarianceCommand from '../commands/resolve-variance-command';
import ApproveInvoiceForPaymentCommand from '../commands/approve-invoice-for-payment-command';

// The Three-Way Match Panel ⭐ — the AP control surface: what we ORDERED
// (PO lines) vs what ARRIVED (the PO's receivedQuantities) vs what the
// vendor INVOICED, per line, within tolerance. Clean lines pass silently;
// variances become work items whose resolutions are explicit, reasoned,
// and stored on the invoice. No path to payment exists around an open
// variance — the guard lives in the command, this panel just makes it
// visible. Unlike the display-only siblings, this is a WORKBENCH: it takes
// @context and runs the two commands itself, so the shared Invoice card
// only needed a one-section additive mount.

interface Signature {
  Args: {
    invoice: any;
    context?: any;
  };
  Element: HTMLElement;
}

export class ThreeWayMatchPanel extends GlimmerComponent<Signature> {
  @tracked busy = false;
  @tracked flash: string | undefined;
  @tracked flashKind: 'ok' | 'warn' = 'ok';
  @tracked resolvingLine: number | undefined;
  @tracked resolveAction = 'accept';
  @tracked resolveReason = '';

  get po() {
    try {
      return this.args.invoice?.purchaseOrder;
    } catch {
      return undefined;
    }
  }

  get rows(): LineMatch[] {
    let po = this.po;
    if (!po) {
      return [];
    }
    let resolved = new Set<number>(
      (this.args.invoice?.varianceResolutions ?? [])
        .filter(Boolean)
        .map((r: any) => r.lineNumber),
    );
    return matchLines(
      po.lineItems ?? [],
      po.receivedQuantities ?? [],
      this.args.invoice?.lineItems ?? [],
      resolved,
    );
  }

  get openCount() {
    return openVarianceCount(this.rows);
  }

  get toleranceLabel() {
    return `tolerance ±${PRICE_TOLERANCE_PCT}% or $${PRICE_TOLERANCE_ABS}`;
  }

  get resolutions() {
    return (this.args.invoice?.varianceResolutions ?? []).filter(Boolean);
  }

  get approved() {
    return ['approved-for-payment', 'partial', 'paid'].includes(
      this.args.invoice?.status ?? '',
    );
  }

  hueFor = (state: string): 'green' | 'red' | 'amber' | 'slate' => {
    switch (state) {
      case 'clean':
        return 'green';
      case 'resolved':
        return 'amber';
      case 'qty-variance':
      case 'price-variance':
      case 'not-on-po':
        return 'red';
      default:
        return 'slate';
    }
  };

  labelFor = (row: LineMatch): string =>
    row.state === 'clean' && row.detail === 'not invoiced'
      ? 'not invoiced'
      : row.state === 'clean'
        ? 'clean'
        : row.state === 'resolved'
          ? 'resolved'
          : row.detail;

  startResolve = (line: number) => {
    this.resolvingLine = line;
    this.resolveAction = 'accept';
    this.resolveReason = '';
    this.flash = undefined;
  };

  cancelResolve = () => {
    this.resolvingLine = undefined;
  };

  setReason = (v: string) => {
    this.resolveReason = v;
  };

  setAction = (v: string) => {
    this.resolveAction = v;
  };

  submitResolve = async () => {
    let ctx = this.args.context?.commandContext;
    if (!ctx || this.resolvingLine == null) {
      return;
    }
    this.busy = true;
    this.flash = undefined;
    try {
      let result = await new ResolveVarianceCommand(ctx).execute({
        invoice: this.args.invoice,
        lineNumber: this.resolvingLine,
        action: this.resolveAction,
        reason: this.resolveReason,
      } as any);
      this.flashKind = 'ok';
      this.flash = (result as any)?.message;
      this.resolvingLine = undefined;
    } catch (e: any) {
      this.flashKind = 'warn';
      this.flash = e?.message ?? String(e);
    } finally {
      this.busy = false;
    }
  };

  approveForPayment = async () => {
    let ctx = this.args.context?.commandContext;
    if (!ctx) {
      return;
    }
    this.busy = true;
    this.flash = undefined;
    try {
      let result = await new ApproveInvoiceForPaymentCommand(ctx).execute({
        invoice: this.args.invoice,
      } as any);
      this.flashKind = 'ok';
      this.flash = (result as any)?.message;
    } catch (e: any) {
      this.flashKind = 'warn';
      this.flash = e?.message ?? String(e);
    } finally {
      this.busy = false;
    }
  };

  <template>
    <div class='match-panel' ...attributes>
      <div class='strip'>
        <StatePill
          @label={{if
            this.openCount
            'EXCEPTION — payment blocked'
            (if this.approved 'APPROVED FOR PAYMENT' 'MATCH CLEAN')
          }}
          @hue={{if this.openCount 'red' 'green'}}
          @emphatic={{true}}
        />
        <span class='strip-note'>{{this.openCount}} open ·
          {{this.toleranceLabel}}</span>
        {{#unless this.approved}}
          <Button
            @kind='primary'
            @size='small'
            @disabled={{if this.openCount true this.busy}}
            class='approve-btn'
            {{on 'click' this.approveForPayment}}
          >
            {{if this.openCount 'Blocked' 'Approve for payment'}}
          </Button>
        {{/unless}}
      </div>

      {{#if this.flash}}
        <p class='flash {{this.flashKind}}'>{{this.flash}}</p>
      {{/if}}

      <div class='table-scroll'>
        <table class='match-table'>
          <thead>
            <tr>
              <th></th>
              <th>PO line</th>
              <th class='num'>Received</th>
              <th class='num'>Invoiced</th>
              <th class='num'>Variance</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {{#each this.rows as |row|}}
              <tr class='state-{{row.state}}'>
                <td class='desc'>{{row.lineNumber}} · {{row.description}}</td>
                <td>{{if row.poQty row.poQty '—'}}
                  {{#if row.poUnitPrice}}×
                    <MoneyDisplay
                      @amount={{row.poUnitPrice}}
                      @currency='USD'
                    />{{/if}}</td>
                <td class='num'>{{if
                    row.receivedQty
                    row.receivedQty
                    (if row.poQty '0' '—')
                  }}</td>
                <td class='num'>{{if row.invQty row.invQty '—'}}
                  {{#if row.invUnitPrice}}×
                    <MoneyDisplay
                      @amount={{row.invUnitPrice}}
                      @currency='USD'
                    />{{/if}}</td>
                <td class='num'>
                  {{#if row.varianceAmount}}
                    <MoneyDisplay
                      @amount={{row.varianceAmount}}
                      @currency='USD'
                    />
                  {{else}}
                    —
                  {{/if}}
                </td>
                <td>
                  <div class='match-cell'>
                    <StatePill
                      @label={{this.labelFor row}}
                      @hue={{this.hueFor row.state}}
                      @dot={{true}}
                    />
                    {{#if (eq row.state 'qty-variance')}}
                      <button
                        type='button'
                        class='resolve-link'
                        {{on 'click' (fn this.startResolve row.lineNumber)}}
                      >resolve</button>
                    {{else if (eq row.state 'price-variance')}}
                      <button
                        type='button'
                        class='resolve-link'
                        {{on 'click' (fn this.startResolve row.lineNumber)}}
                      >resolve</button>
                    {{else if (eq row.state 'not-on-po')}}
                      <button
                        type='button'
                        class='resolve-link'
                        {{on 'click' (fn this.startResolve row.lineNumber)}}
                      >resolve</button>
                    {{/if}}
                  </div>
                </td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      </div>

      {{#if this.resolvingLine}}
        <div class='resolve-form'>
          <span class='rf-title'>Resolve line {{this.resolvingLine}}</span>
          <div class='rf-actions'>
            {{#each this.actionOptions as |opt|}}
              <label class='rf-opt {{if (eq this.resolveAction opt.v) "on"}}'>
                <input
                  type='radio'
                  name='variance-action'
                  checked={{eq this.resolveAction opt.v}}
                  {{on 'change' (fn this.setAction opt.v)}}
                />
                {{opt.label}}
              </label>
            {{/each}}
          </div>
          <BoxelInput
            @value={{this.resolveReason}}
            @onInput={{this.setReason}}
            @placeholder='Reason (required — this is the audit line)'
          />
          <div class='rf-buttons'>
            <Button
              @kind='primary'
              @size='small'
              @disabled={{this.busy}}
              {{on 'click' this.submitResolve}}
            >Record resolution</Button>
            <Button
              @kind='secondary-light'
              @size='small'
              {{on 'click' this.cancelResolve}}
            >Cancel</Button>
          </div>
        </div>
      {{/if}}

      {{#if this.resolutions.length}}
        <div class='res-history'>
          <span class='rh-title'>Resolution history</span>
          {{#each this.resolutions as |r|}}
            <div class='rh-row'>line {{r.lineNumber}} — {{r.action}}:
              {{r.reason}}</div>
          {{/each}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      .match-panel {
        --panel-ink: var(--procurement-ink, var(--primary, var(--boxel-dark)));
        display: grid;
        gap: var(--boxel-sp-sm);
        font-size: 0.875rem;
      }
      .strip {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        flex-wrap: wrap;
      }
      .strip-note {
        color: var(--muted-foreground, var(--boxel-450));
        font-size: 0.8125rem;
        font-variant-numeric: tabular-nums;
      }
      .approve-btn {
        margin-left: auto;
      }
      .flash {
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--radius, var(--boxel-border-radius));
        font-size: 0.8125rem;
      }
      .flash.ok {
        background: color-mix(
          in oklch,
          var(--state-green-fg, var(--boxel-dark)) 10%,
          transparent
        );
      }
      .flash.warn {
        background: color-mix(
          in oklch,
          var(--state-amber-fg, var(--boxel-dark)) 12%,
          transparent
        );
      }
      .table-scroll {
        overflow-x: auto;
      }
      .match-table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        text-align: left;
        border-bottom: 1px solid var(--border, var(--boxel-200));
        vertical-align: middle;
        font-size: 0.8125rem;
      }
      thead th {
        font-size: 0.6875rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, var(--boxel-450));
        border-bottom: 2px solid var(--panel-ink);
      }
      th.num,
      td.num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .desc {
        font-weight: 600;
      }
      tr.state-qty-variance,
      tr.state-price-variance,
      tr.state-not-on-po {
        background: color-mix(
          in oklch,
          var(--state-red-fg, var(--boxel-dark)) 5%,
          transparent
        );
      }
      .match-cell {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .resolve-link {
        border: none;
        background: none;
        color: var(--panel-ink);
        font: inherit;
        font-size: 0.75rem;
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
        padding: 0;
      }
      .resolve-form {
        border: 1px solid var(--border, var(--boxel-200));
        border-left: 3px solid var(--panel-ink);
        border-radius: var(--radius, var(--boxel-border-radius));
        padding: var(--boxel-sp-sm);
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .rf-title {
        font-weight: 700;
        font-size: 0.8125rem;
      }
      .rf-actions {
        display: flex;
        gap: var(--boxel-sp-sm);
        flex-wrap: wrap;
      }
      .rf-opt {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 0.8125rem;
        cursor: pointer;
      }
      .rf-buttons {
        display: flex;
        gap: var(--boxel-sp-xs);
      }
      .res-history {
        border-top: 1px dashed var(--border, var(--boxel-300));
        padding-top: var(--boxel-sp-xs);
        display: grid;
        gap: 2px;
      }
      .rh-title {
        font-size: 0.6875rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rh-row {
        font-size: 0.8125rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>

  actionOptions = [
    { v: 'accept', label: 'Accept with reason' },
    { v: 'short-pay', label: 'Short-pay' },
    { v: 'reject-line', label: 'Reject line' },
  ];
}
