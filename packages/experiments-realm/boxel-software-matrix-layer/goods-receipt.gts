import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { Button } from '@cardstack/boxel-ui/components';

import { PurchaseOrder } from './purchase-order';
import ReceiveGoodsCommand from './commands/receive-goods-command';
import { StatePill } from './components/state-pill';
import { stateColor, type StateColor } from './utils/index';

export type MatchState = 'matched' | 'short' | 'over';

export const MATCH_STATE_COLORS: Record<MatchState, StateColor> = {
  matched: stateColor('green'),
  short: stateColor('amber'),
  over: stateColor('red'),
};

export function matchStateOf(
  ordered?: number | null,
  received?: number | null,
): MatchState {
  let o = ordered ?? 0;
  let r = received ?? 0;
  if (r < o) {
    return 'short';
  }
  if (r > o) {
    return 'over';
  }
  return 'matched';
}

// One received line, checked against the PO's ordered quantity. qtyOrdered
// is a SNAPSHOT taken when the receipt is recorded — the receipt is an audit
// document and must keep saying what was ordered at the time, even if the PO
// is later edited.
export class ReceiptLineField extends FieldDef {
  static displayName = 'Receipt Line';

  @field description = contains(StringField);
  @field qtyOrdered = contains(NumberField);
  @field qtyReceived = contains(NumberField);
  @field note = contains(StringField);

  @field matchState = contains(StringField, {
    computeVia: function (this: ReceiptLineField) {
      return matchStateOf(this.qtyOrdered, this.qtyReceived);
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get hue(): 'green' | 'amber' | 'red' {
      switch (this.args.model?.matchState) {
        case 'short':
          return 'amber';
        case 'over':
          return 'red';
        default:
          return 'green';
      }
    }
    get delta() {
      let o = this.args.model?.qtyOrdered ?? 0;
      let r = this.args.model?.qtyReceived ?? 0;
      let d = r - o;
      if (d === 0) {
        return 'matched';
      }
      return d > 0 ? `over +${d}` : `short ${d}`;
    }
    <template>
      <div class='line'>
        <span class='desc'>{{@model.description}}</span>
        <span class='qty'>{{@model.qtyReceived}} / {{@model.qtyOrdered}}</span>
        <StatePill @label={{this.delta}} @hue={{this.hue}} @dot={{true}} />
        {{#if @model.note}}<span class='note'>{{@model.note}}</span>{{/if}}
      </div>
      <style scoped>
        .line {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-4xs) 0;
          font-size: 0.875rem;
        }
        .desc {
          font-weight: 600;
        }
        .qty {
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .note {
          grid-column: 1 / -1;
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
        }
      </style>
    </template>
  };
}

// A record of what physically arrived against one PO — the receiving half of
// the two-way match. Multiple receipts can accumulate against the same PO
// (partial receiving); ReceiveGoodsCommand is the single writer that creates
// these, flips the PO's status, and moves the received value from the
// budget's `committed` to `actual`.
export class GoodsReceipt extends CardDef {
  static displayName = 'Goods Receipt';
  static headerColor = '#3e4e88';

  @field purchaseOrder = linksTo(() => PurchaseOrder);
  @field receivedOn = contains(DateField);
  @field receivedBy = contains(StringField);
  @field lines = containsMany(ReceiptLineField);
  // Set only by ReceiveGoodsCommand when the receipt is applied to its PO
  // and budget — a posted receipt is immutable in spirit and cannot be
  // posted twice.
  @field posted = contains(BooleanField);

  @field matchResult = contains(StringField, {
    computeVia: function (this: GoodsReceipt) {
      let lines = (this.lines ?? []).filter(Boolean);
      if (!lines.length) {
        return 'empty';
      }
      if (lines.some((l) => l.matchState === 'over')) {
        return 'over';
      }
      if (lines.some((l) => l.matchState === 'short')) {
        return 'partial';
      }
      return 'matched';
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: GoodsReceipt) {
      let d = this.receivedOn;
      let day = d
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
      return day ? `Goods Receipt · ${day}` : 'Goods Receipt';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    @tracked busy = false;
    @tracked error: string | undefined;
    @tracked message: string | undefined;

    post = async () => {
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
        let result = await new ReceiveGoodsCommand(commandContext).execute({
          receipt: model,
        } as any);
        this.message = (result as any)?.message;
      } catch (error: any) {
        this.error = error?.message ?? String(error);
      } finally {
        this.busy = false;
      }
    };

    get matchHue(): 'green' | 'amber' | 'red' | 'slate' {
      switch (this.args.model?.matchResult) {
        case 'matched':
          return 'green';
        case 'partial':
          return 'amber';
        case 'over':
          return 'red';
        default:
          return 'slate';
      }
    }
    get matchLabel() {
      switch (this.args.model?.matchResult) {
        case 'matched':
          return 'FULLY MATCHED';
        case 'partial':
          return 'PARTIAL — short lines';
        case 'over':
          return 'OVER-RECEIPT — check notes';
        default:
          return 'NO LINES';
      }
    }
    get receivedOnLabel() {
      let d = this.args.model?.receivedOn;
      return d
        ? d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '—';
    }
    <template>
      <article class='gr'>
        <header class='head'>
          <div>
            <p class='kicker'>Goods Receipt</p>
            <h1>{{@model.title}}</h1>
            <p class='sub'>received {{this.receivedOnLabel}} by
              {{@model.receivedBy}}</p>
          </div>
          <div class='head-right'>
            <StatePill
              @label={{this.matchLabel}}
              @hue={{this.matchHue}}
              @emphatic={{true}}
            />
            {{#if @model.posted}}
              <StatePill @label='POSTED' @hue='green' @dot={{true}} />
            {{else}}
              <Button
                @kind='primary'
                @size='small'
                @disabled={{this.busy}}
                {{on 'click' this.post}}
              >Post receipt</Button>
            {{/if}}
          </div>
        </header>

        {{#if this.error}}<div class='flash error'>{{this.error}}</div>{{/if}}
        {{#if this.message}}<div class='flash ok'>{{this.message}}</div>{{/if}}

        <section class='panel'>
          <h2>Lines · received / ordered</h2>
          <div class='lines'>
            {{#each @fields.lines as |Line|}}
              <Line />
            {{else}}
              <p class='empty'>No lines recorded.</p>
            {{/each}}
          </div>
        </section>

        {{#if @model.purchaseOrder}}
          <section class='panel'>
            <h2>Against Purchase Order</h2>
            <@fields.purchaseOrder @format='embedded' />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .gr {
          container-type: inline-size;
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
          display: grid;
          gap: var(--boxel-sp);
        }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          padding-bottom: var(--boxel-sp);
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
          gap: var(--boxel-sp-xxs);
        }
        .flash {
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
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
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
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
        @container (max-width: 560px) {
          .head {
            flex-direction: column;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get matchHue(): 'green' | 'amber' | 'red' | 'slate' {
      switch (this.args.model?.matchResult) {
        case 'matched':
          return 'green';
        case 'partial':
          return 'amber';
        case 'over':
          return 'red';
        default:
          return 'slate';
      }
    }
    get lineCount() {
      return (this.args.model?.lines ?? []).length;
    }
    <template>
      <div class='row'>
        <span class='name'>{{@model.title}}</span>
        <span class='count'>{{this.lineCount}} lines</span>
        <StatePill
          @label={{@model.matchResult}}
          @hue={{this.matchHue}}
          @dot={{true}}
        />
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
        }
        .count {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.title}} · {{@model.matchResult}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get lineCount() {
      return (this.args.model?.lines ?? []).length;
    }
    <template>
      <div class='fit'>
        <span class='fit-name'>{{@model.title}}</span>
        <span class='fit-sub'>{{this.lineCount}} lines ·
          {{@model.matchResult}}</span>
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
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-sub {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container fitted-card (height <= 65px) {
          .fit {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-xs);
          }
        }
      </style>
    </template>
  };
}
