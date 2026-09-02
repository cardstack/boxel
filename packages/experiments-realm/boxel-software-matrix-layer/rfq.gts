import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import enumField from '@cardstack/base/enum';
import { realmURL } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';

import { LineItem } from './line-item';
import { Vendor } from './vendor';
import { VendorQuote } from './vendor-quote';
import { PurchaseRequisition } from './purchase-requisition';
import { on } from '@ember/modifier';
import { Button } from '@cardstack/boxel-ui/components';

import { StatePill } from './components/state-pill';
import { RfqComparisonBoard } from './components/rfq-comparison-board';
import AwardRfqCommand from './commands/award-rfq-command';
import SendRfqCommand from './commands/send-rfq-command';
import { stateColor, type StateColor } from './utils/index';

export const RFQ_STATUSES = [
  'draft',
  'sent',
  'comparing',
  'awarded',
  'cancelled',
];

export const RFQ_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  comparing: 'Comparing',
  awarded: 'Awarded',
  cancelled: 'Cancelled',
};

export const RFQ_STATUS_COLORS: Record<string, StateColor> = {
  draft: stateColor('slate'),
  sent: stateColor('blue'),
  comparing: stateColor('amber'),
  awarded: stateColor('green'),
  cancelled: stateColor('red'),
};

const STATUS_HUES: Record<string, 'slate' | 'blue' | 'amber' | 'green' | 'red'> =
  {
    draft: 'slate',
    sent: 'blue',
    comparing: 'amber',
    awarded: 'green',
    cancelled: 'red',
  };

export const RfqStatusField = enumField(StringField, {
  options: RFQ_STATUSES.map((value) => ({
    value,
    label: RFQ_STATUS_LABELS[value],
  })),
  displayName: 'RFQ Status',
});

// A formal ask for competitive prices: which lines, sent to which vendors,
// with the buyer recording each inbound quote (open-comparison mode — quotes
// are visible as they arrive; the deadline is informational). The isolated
// format IS the comparison board: quotes line up column-per-vendor and Award
// converts the winner into a draft Purchase Order via AwardRfqCommand.
export class Rfq extends CardDef {
  static displayName = 'RFQ';
  static headerColor = '#3e4e88';
  static prefersWideFormat = true;

  @field requisition = linksTo(() => PurchaseRequisition);
  @field lineItems = containsMany(LineItem);
  @field invitedVendors = linksToMany(() => Vendor);
  @field quotes = linksToMany(() => VendorQuote);
  @field status = contains(RfqStatusField);
  @field responseDeadline = contains(DateField);
  @field awardedQuote = linksTo(() => VendorQuote);

  static isolated = class Isolated extends Component<typeof this> {
    @tracked awardBusy = false;
    @tracked awardError: string | undefined;
    @tracked awardMessage: string | undefined;

    get statusHue() {
      return STATUS_HUES[this.args.model?.status ?? 'draft'] ?? 'slate';
    }
    get statusLabel() {
      return RFQ_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Draft';
    }
    get quotes() {
      try {
        return (this.args.model?.quotes ?? []).filter(Boolean);
      } catch {
        return [];
      }
    }
    get decided() {
      let s = this.args.model?.status;
      return s === 'awarded' || s === 'cancelled';
    }
    get isDraft() {
      let s = this.args.model?.status;
      return !s || s === 'draft';
    }
    get awardedId() {
      try {
        return this.args.model?.awardedQuote?.id;
      } catch {
        return undefined;
      }
    }
    get deadlineLabel() {
      let d = this.args.model?.responseDeadline;
      return d
        ? d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : 'no deadline set';
    }
    get invitedCount() {
      try {
        return (this.args.model?.invitedVendors ?? []).length;
      } catch {
        return 0;
      }
    }

    send = async () => {
      let model = this.args.model;
      if (!model) {
        return;
      }
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        this.awardError = 'Commands are unavailable in this mode';
        return;
      }
      this.awardError = undefined;
      this.awardMessage = undefined;
      this.awardBusy = true;
      try {
        let result = await new SendRfqCommand(commandContext).execute({
          rfq: model,
        } as any);
        this.awardMessage = (result as any)?.message;
      } catch (error: any) {
        this.awardError = error?.message ?? String(error);
      } finally {
        this.awardBusy = false;
      }
    };

    openProfile = (profile: unknown) => {
      (this.args as any).viewCard?.(profile, 'isolated');
    };

    award = async (quote: VendorQuote) => {
      let model = this.args.model;
      if (!model) {
        return;
      }
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        this.awardError = 'Commands are unavailable in this mode';
        return;
      }
      let realm = (model as any)?.[realmURL]?.href;
      if (!realm) {
        this.awardError = 'Could not determine the realm for the new PO';
        return;
      }
      this.awardError = undefined;
      this.awardMessage = undefined;
      this.awardBusy = true;
      try {
        let result = await new AwardRfqCommand(commandContext).execute({
          rfq: model,
          quote,
          realm,
        } as any);
        this.awardMessage = (result as any)?.message;
      } catch (error: any) {
        this.awardError = error?.message ?? String(error);
      } finally {
        this.awardBusy = false;
      }
    };

    <template>
      <article class='rfq'>
        <header class='head command-band'>
          <div>
            <p class='kicker'>Request for Quote</p>
            <h1>{{@model.title}}</h1>
            <p class='sub'>{{this.quotes.length}} quotes ·
              {{this.invitedCount}} vendors invited · deadline
              {{this.deadlineLabel}}</p>
          </div>
          <div class='head-right'>
            <StatePill
              @label={{this.statusLabel}}
              @hue={{this.statusHue}}
              @emphatic={{true}}
            />
            {{#if this.isDraft}}
              <Button
                @kind='primary'
                @size='small'
                @disabled={{this.awardBusy}}
                {{on 'click' this.send}}
              >Send RFQ</Button>
            {{/if}}
          </div>
        </header>

        {{#if this.awardError}}
          <div class='flash error'>{{this.awardError}}</div>
        {{/if}}
        {{#if this.awardMessage}}
          <div class='flash ok'>{{this.awardMessage}}</div>
        {{/if}}

        <section class='panel board-panel'>
          <h2>Quote Comparison</h2>
          <RfqComparisonBoard
            @quotes={{this.quotes}}
            @onAward={{this.award}}
            @busy={{this.awardBusy}}
            @awardedId={{this.awardedId}}
            @decided={{this.decided}}
            @onOpenProfile={{this.openProfile}}
          />
        </section>

        <div class='grid'>
          <section class='panel'>
            <h2>Requested Lines</h2>
            <div class='lines'>
              {{#each @fields.lineItems as |Line|}}
                <Line />
              {{else}}
                <p class='empty'>No lines yet — copy them from the
                  requisition.</p>
              {{/each}}
            </div>
          </section>

          <section class='panel'>
            <h2>Provenance</h2>
            {{#if @model.requisition}}
              <@fields.requisition @format='embedded' />
            {{else}}
              <p class='empty'>No requisition linked (direct RFQ).</p>
            {{/if}}
            {{#if @model.invitedVendors.length}}
              <h2 class='mt'>Invited Vendors</h2>
              <div class='vendor-list'>
                {{#each @fields.invitedVendors as |V|}}
                  <V @format='atom' />
                {{/each}}
              </div>
            {{/if}}
          </section>
        </div>
      </article>
      <style scoped>
        .rfq {
          /* command-console adapter tokens */
          --console-ink: var(--procurement-ink, var(--primary, var(--boxel-dark)));
          --console-ink-fg: var(--procurement-ink-fg, var(--primary-foreground, var(--boxel-light)));
          container-type: inline-size;
          padding: 0 var(--boxel-sp-lg) var(--boxel-sp-lg);
          background:
            radial-gradient(
              1200px 380px at 18% -8%,
              color-mix(in oklch, var(--console-ink) 7%, transparent),
              transparent 65%
            ),
            var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .command-band {
          background:
            linear-gradient(
              120deg,
              color-mix(in oklch, var(--console-ink) 96%, black),
              var(--console-ink) 55%,
              color-mix(in oklch, var(--console-ink) 82%, #4a5bc4)
            );
          color: var(--console-ink-fg);
          margin: 0 calc(-1 * var(--boxel-sp-lg)) var(--boxel-sp);
          padding: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-sm);
          position: relative;
          overflow: hidden;
        }
        .command-band::after {
          /* fine ledger grid — the ambient texture of the cockpit */
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(
              color-mix(in oklch, var(--console-ink-fg) 7%, transparent) 1px,
              transparent 1px
            ),
            linear-gradient(
              90deg,
              color-mix(in oklch, var(--console-ink-fg) 7%, transparent) 1px,
              transparent 1px
            );
          background-size: 28px 28px;
          mask-image: linear-gradient(to bottom, black, transparent 90%);
          pointer-events: none;
        }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp);
        }
        .kicker {
          margin: 0;
          font-size: 0.6875rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: color-mix(in oklch, var(--console-ink-fg) 65%, transparent);
        }
        h1 {
          margin: var(--boxel-sp-5xs) 0;
          font-family: var(--font-heading, inherit);
          font-size: 1.75rem;
          line-height: 1.15;
          letter-spacing: -0.015em;
        }
        .sub {
          margin: 0;
          color: color-mix(in oklch, var(--console-ink-fg) 72%, transparent);
          font-variant-numeric: tabular-nums;
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
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        .board-panel {
          margin-bottom: var(--boxel-sp);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h2.mt {
          margin-top: var(--boxel-sp);
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
        }
        .lines {
          display: grid;
          gap: var(--boxel-sp-5xs);
        }
        .vendor-list {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.875rem;
          font-style: italic;
        }
        @media (prefers-reduced-motion: no-preference) {
          .command-band {
            animation: rfq-band-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }
          .board-panel {
            animation: rfq-rise 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
            animation-delay: 120ms;
          }
          .grid > .panel {
            animation: rfq-rise 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }
          .grid > .panel:nth-child(1) {
            animation-delay: 220ms;
          }
          .grid > .panel:nth-child(2) {
            animation-delay: 290ms;
          }
        }
        @keyframes rfq-band-in {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes rfq-rise {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @container (max-width: 640px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .head {
            flex-direction: column;
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
      return RFQ_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Draft';
    }
    get quoteCount() {
      try {
        return (this.args.model?.quotes ?? []).length;
      } catch {
        return 0;
      }
    }
    <template>
      <div class='row'>
        <span class='name'>{{@model.title}}</span>
        <span class='count'>{{this.quoteCount}} quotes</span>
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
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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
      return RFQ_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Draft';
    }
    get lineCount() {
      return (this.args.model?.lineItems ?? []).length;
    }
    get deadlineLabel() {
      let d = this.args.model?.responseDeadline;
      return d
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
    }
    <template>
      <div class='fit'>
        <span class='fit-name'>{{@model.title}}</span>
        <span class='fit-sub'>{{this.lineCount}} lines{{#if
            this.deadlineLabel
          }} · quotes due {{this.deadlineLabel}}{{/if}}</span>
        <span class='fit-status'>{{this.statusLabel}}</span>
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
        }
        .fit-status {
          margin-top: auto;
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-450));
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
          .fit-status {
            margin-top: 0;
            margin-left: auto;
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
      </style>
    </template>
  };
}
