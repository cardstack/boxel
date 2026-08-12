import {
  CardDef,
  Component,
  contains,
  linksTo,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

import { CollectionCase, TERMS } from 'ledgerworks/billing-kit';
import { MoneyField } from 'cardstack/contracts';
// THE NEW MAJOR. `ledgerworks/billing-kit` is sealed to 0.2.0 of this same
// package; this one takes 1.0.0. Both render on the page below.
import Select from 'openkit/controls';

// acme/rfq-to-payment — layer 06, the customer's own solution.
//
// ─── PASS 2 (1.0.1): the re-seal ────────────────────────────────────────────
//
// Nothing in this file changed. ledgerworks shipped 1.1.0 — an embedded format
// for CollectionCase, so a linked case renders as a working row instead of a
// bare title chip — and acme's range `^1.1.0` admits it. But 1.0.0 of THIS
// pack is sealed against billing-kit@1.0.0 and always will be; a seal does not
// drift. Picking up a compatible improvement from below therefore costs a
// republish here, and that is the point rather than a defect: the customer
// decides when their app moves, and the act of deciding is a new Version with
// a new pin that anyone can read.
//
// This is the "UPDATE button" of §7 seen from the top of the stack. A minor
// from a vendor two layers down did NOT reach in and change what acme ships.
//
// The top of the stack. Acme writes no fields, no controls, no record types
// and no process — they ASSEMBLE, which is what a customer should be doing and
// what every layer beneath exists to make possible.
//
// ─── WHAT THIS CARD IS FOR ──────────────────────────────────────────────────
//
// It is the page where the slice's central claim either holds or does not:
// TWO MAJORS OF ONE COMPONENT, side by side, each behaving as its own seal
// says it should.
//
//   * The Select on the left comes through `ledgerworks/billing-kit`, which
//     sealed `openkit/controls: ^0.2.0`. No search field. Popup clipped by an
//     ancestor with `overflow: hidden`.
//   * The Select on the right is imported here at `^1.0.0`. Search, groups,
//     multiple selection, and a popup portaled to <body> that nothing clips.
//
// Same component name, same publisher, one page, two behaviours, neither one
// degraded. If that works, an ISV can ship a qualified product into a realm
// that has already moved on, and a UI library can cut a major without asking
// permission from every downstream vendor first. If it does not work, the
// versioning story is decorative.
//
// ─── AND THE THING ACME MUST NOT BE ABLE TO DO ──────────────────────────────
//
// Acme cannot reach up and change what ledgerworks sealed. There is no
// argument on this card, no realm setting, and no import here that makes the
// left-hand Select gain a search field. That is the property; the absence of
// an escape hatch is the feature.

interface Option {
  key: string;
  label: string;
  description?: string;
  group?: string;
}

const APPROVERS: Option[] = [
  { key: 'ap-1', label: 'Accounts payable', description: 'Up to 5,000' },
  { key: 'ap-2', label: 'Finance manager', description: 'Up to 50,000' },
  { key: 'ap-3', label: 'CFO', description: 'Above 50,000', group: 'Executive' },
  {
    key: 'ap-4',
    label: 'Board',
    description: 'Above 250,000',
    group: 'Executive',
  },
];

export class PaymentRun extends CardDef {
  static displayName = 'Payment Run';

  @field runName = contains(StringField);
  // `searchable`, because a payment run is found BY its case in every
  // operational query anyone will write against this.
  @field openCase = linksTo(CollectionCase, { searchable: true });
  @field released = contains(MoneyField);

  static isolated = class Isolated extends Component<typeof PaymentRun> {
    @tracked approvers: Option[] = [];

    approverOptions = APPROVERS;
    termsOptions = TERMS;

    @action chooseApprovers(selection: Option | Option[]) {
      this.approvers = Array.isArray(selection) ? selection : [selection];
    }

    <template>
      <section class='run'>
        <header>
          <h1>{{if @model.runName @model.runName 'Payment run'}}</h1>
          <p class='lede'>Two majors of
            <code>openkit/controls</code>
            on one page. Neither is degraded; each is doing exactly what its
            own seal says.</p>
        </header>

        <div class='pair'>
          <article class='side'>
            <p class='pin'>via ledgerworks/billing-kit → controls@0.2.0</p>
            {{! Rendered THROUGH the kit, so the kit's own sealed scope
                decides which module this resolves to — not this card. }}
            <div class='clip'>
              <@fields.openCase />
            </div>
            <p class='note'>Inside an
              <code>overflow: hidden</code>
              box. 0.2.0's popup is a DOM descendant, so it is clipped.</p>
          </article>

          <article class='side'>
            <p class='pin'>direct → controls@1.0.0</p>
            <div class='clip'>
              <Select
                @options={{this.approverOptions}}
                @selected={{this.approvers}}
                @onChange={{this.chooseApprovers}}
                @label='Approvers'
                @placeholder='Pick approvers'
                @searchable={{true}}
                @multiple={{true}}
              />
            </div>
            <p class='note'>Same box. 1.0.0 is portaled to
              <code>&lt;body&gt;</code>, so it escapes.</p>
          </article>
        </div>

        <footer class='stack'>
          <p class='stack-title'>Resolved stack</p>
          <ol>
            <li>acme/rfq-to-payment@1.0.0 <em>(this card)</em></li>
            <li>ledgerworks/billing-kit@1.0.0</li>
            <li>northwind/records@1.0.0</li>
            <li>iso/money-codes@1.1.0 <em>(sealed from ^1.0.0)</em></li>
            <li>cardstack/contracts@1.0.0</li>
            <li>openkit/controls@1.0.0 <em>and</em> @0.2.0</li>
          </ol>
        </footer>
      </section>

      <style scoped>
        .run {
          --ac-ink: var(--foreground, #1c1e26);
          --ac-ink-2: var(--muted-foreground, #6b6f80);
          --ac-line: var(--border, #dfe1ea);
          --ac-sp: var(--boxel-sp, 1rem);

          display: flex;
          flex-direction: column;
          gap: var(--ac-sp);
          padding: var(--ac-sp);
          color: var(--ac-ink);
          font-family: var(--font-sans, system-ui, sans-serif);
        }
        h1 {
          margin: 0;
          font-size: 1.25rem;
        }
        .lede {
          margin: 0.25rem 0 0;
          color: var(--ac-ink-2);
        }
        .pair {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
          gap: var(--ac-sp);
        }
        .side {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .pin {
          margin: 0;
          color: var(--primary, #3d6bff);
          font-family: ui-monospace, monospace;
          font-size: 0.6875rem;
        }
        /* The comparison IS the clipping box. Both sides get the same one, so
           any difference on screen is the component and never the container. */
        .clip {
          max-height: 7rem;
          overflow: hidden;
          padding: 0.5rem;
          border: 1px dashed var(--ac-line);
          border-radius: var(--boxel-border-radius, 0.75rem);
        }
        .note {
          margin: 0;
          color: var(--ac-ink-2);
          font-size: 0.8125rem;
        }
        .stack {
          padding-top: var(--ac-sp);
          border-top: 1px solid var(--ac-line);
        }
        .stack-title {
          margin: 0 0 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ac-ink-2);
        }
        .stack ol {
          margin: 0;
          padding-left: 1.25rem;
          font-family: ui-monospace, monospace;
          font-size: 0.75rem;
          line-height: 1.7;
        }
        .stack em {
          color: var(--ac-ink-2);
          font-style: normal;
        }
        code {
          font-family: ui-monospace, monospace;
          font-size: 0.9em;
        }
      </style>
    </template>
  };
}
