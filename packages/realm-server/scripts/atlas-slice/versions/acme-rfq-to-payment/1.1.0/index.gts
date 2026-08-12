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

import { CollectionCase } from 'ledgerworks/billing-kit';
import { MoneyField } from 'cardstack/contracts';
// THE NEW MAJOR. `ledgerworks/billing-kit` is sealed to 0.2.0 of this same
// package; this one takes 1.0.0. Both render on the page below.
import Select from 'openkit/controls';

// acme/rfq-to-payment — layer 06, the customer's own solution.
//
// The top of the stack. Acme writes no fields, no controls, no record types
// and no process — they ASSEMBLE, which is what a customer should be doing and
// what every layer beneath exists to make possible.
//
// ─── WHAT THIS CARD IS FOR ──────────────────────────────────────────────────
//
// It is the page where the slice's central claim either holds or does not:
// TWO MAJORS OF ONE COMPONENT, side by side, each behaving as its own seal
// says it should. The left Select arrives through `ledgerworks/billing-kit`,
// which sealed `openkit/controls: ^0.2.0`; the right is imported here at
// `^1.0.0`. Same name, same publisher, one page, two behaviours, neither
// degraded.
//
// AND THE THING ACME MUST NOT BE ABLE TO DO. There is no argument on this
// card, no realm setting and no import here that makes the left-hand Select
// gain a search field. The absence of an escape hatch is the feature.
//
// ─── PASS 4 (1.1.0): make it look like a product ────────────────────────────
//
// Everything through 1.0.2 was correct and looked like a debug dump: dashed
// borders, terminal-green monospace captions, a numbered list for the resolved
// stack, and comparison boxes wide enough to leave a lake of white beside a
// control sitting at its natural width. A page whose entire job is to be
// LOOKED AT cannot be styled like console output — if the reader has to work
// to see the difference, the demonstration has failed regardless of whether
// the machinery underneath is right.
//
// What changed, and why each was wrong rather than merely plain:
//
//   * DASHED BORDERS ARE A DEBUG AFFORDANCE. They say "placeholder". The
//     clipping viewport is now a real inset surface with a corner tag naming
//     the constraint, which is the actual subject rather than a hint at it.
//   * MONOSPACE IS FOR CODE. Versions and specifiers stay mono because they
//     are identifiers a reader may retype; prose captions do not.
//   * SIZED TO THE CONTENT. The viewports are the width a dropdown wants plus
//     its margins, so the two sides are directly comparable and neither has
//     dead space. A comparison with different-sized halves is not a
//     comparison.
//   * THE STACK IS A TABLE, because it is tabular: layer, package, version,
//     and why that version. A numbered list threw away three of those four.
//
// COMPATIBLE: presentation only, no argument or field moved.

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

// The resolved stack as DATA, so the template renders a table instead of
// hand-set rows. Still hand-written — see the note in the footer — but at
// least it is now shaped like the thing it describes.
const STACK = [
  {
    layer: '06',
    name: 'acme/rfq-to-payment',
    version: '1.1.0',
    note: 'this card',
  },
  {
    layer: '05.5',
    name: 'ledgerworks/billing-kit',
    version: '1.2.0',
    note: 'sealed to controls@0.2.0',
  },
  { layer: '05', name: 'northwind/records', version: '1.1.0', note: '' },
  {
    layer: '04',
    name: 'iso/money-codes',
    version: '1.2.0',
    note: 'sealed from ^1.0.0',
  },
  {
    layer: '03',
    name: 'openkit/controls',
    version: '1.0.0 + 0.2.0',
    note: 'both majors live',
  },
  { layer: '02', name: 'cardstack/contracts', version: '1.1.0', note: '' },
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
    stack = STACK;

    @action chooseApprovers(selection: Option | Option[]) {
      this.approvers = Array.isArray(selection) ? selection : [selection];
    }

    <template>
      <article class='run'>
        <header class='head'>
          <h1>{{if @model.runName @model.runName 'Payment run'}}</h1>
          <p class='lede'>Two majors of
            <code>openkit/controls</code>
            are live on this page. Neither is degraded — each is doing exactly
            what its own seal says.</p>
        </header>

        <section class='compare'>
          <article class='panel'>
            <header class='panel-head'>
              <span class='pill'>controls@0.2.0</span>
              <span class='route'>via ledgerworks/billing-kit</span>
            </header>
            {{! Rendered THROUGH the kit, so the kit's own sealed scope decides
                which module this resolves to — not this card. }}
            <div class='viewport'>
              <span class='viewport-tag'>overflow: hidden</span>
              <@fields.openCase @format='embedded' />
            </div>
            <p class='caption'>The popup is a DOM descendant, so this box
              <strong>clips it</strong>. No search field: 0.2.0 has one, but
              only when asked, and the kit does not ask.</p>
          </article>

          <article class='panel'>
            <header class='panel-head'>
              <span class='pill is-new'>controls@1.0.0</span>
              <span class='route'>imported directly</span>
            </header>
            <div class='viewport'>
              <span class='viewport-tag'>overflow: hidden</span>
              <div class='field'>
                <span class='field-label'>Approvers</span>
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
            </div>
            <p class='caption'>Identical box. 1.0.0 portals to
              <code>&lt;body&gt;</code>, so it
              <strong>escapes</strong>
              — with search, groups and multiple selection.</p>
          </article>
        </section>

        <section class='stack'>
          <h2>Resolved stack</h2>
          <table>
            <thead>
              <tr>
                <th class='c-layer'>Layer</th>
                <th class='c-name'>Package</th>
                <th class='c-version'>Version</th>
                <th class='c-note'>Why</th>
              </tr>
            </thead>
            <tbody>
              {{#each this.stack key='name' as |row|}}
                <tr>
                  <td class='c-layer'>{{row.layer}}</td>
                  <td class='c-name'>{{row.name}}</td>
                  <td class='c-version'><span
                      class='pill'
                    >{{row.version}}</span></td>
                  <td class='c-note'>{{row.note}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
          {{! Still hand-written, and still the wrong shape — it wants to be
              read off the seal. Left visible rather than quietly deleted:
              the honest version of this table cannot go stale, and that needs
              a way to ask the pack manifest at render time. Owed. }}
          <p class='owed'>Hand-written. The honest version reads these from the
            pack manifest at render time, so it cannot go stale.</p>
        </section>
      </article>

      <style scoped>
        .run {
          /* Every fallback stated once, here at the root. Reads below are bare
             var(), so a theme can move any of these without this file holding
             a second opinion about the default. */
          --ac-surface: var(--card, #ffffff);
          --ac-sunk: var(--muted, #f6f7fa);
          --ac-ink: var(--foreground, #16181f);
          --ac-ink-2: var(--muted-foreground, #6b6f80);
          --ac-line: var(--border, #e3e5ec);
          --ac-accent: var(--primary, #3d6bff);
          --ac-radius: var(--boxel-border-radius, 0.75rem);
          --ac-radius-sm: var(--boxel-border-radius-sm, 0.5rem);
          --ac-sp: var(--boxel-sp, 1rem);
          --ac-sp-lg: var(--boxel-sp-lg, 1.5rem);
          --ac-sp-sm: var(--boxel-sp-xs, 0.625rem);
          --ac-sp-xs: var(--boxel-sp-xxs, 0.5rem);
          --ac-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
          /* Hairline and elevation as ONE token, so raising a surface can
             never leave its outline behind. */
          --ac-raise: 0 0 0 1px var(--ac-line), 0 1px 2px rgb(0 0 0 / 0.04);

          display: flex;
          flex-direction: column;
          gap: var(--ac-sp-lg);
          padding: var(--ac-sp-lg);
          background-color: var(--ac-surface);
          color: var(--ac-ink);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--boxel-font-size, 0.875rem);
          line-height: 1.5;
        }

        .head h1 {
          margin: 0;
          font-size: 1.375rem;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .lede {
          /* Measure, not full width: a line of prose past ~70 characters is
             harder to track back from. */
          max-width: 46ch;
          margin: var(--ac-sp-xs) 0 0;
          color: var(--ac-ink-2);
          font-size: 0.9375rem;
        }

        .compare {
          display: grid;
          /* Both halves the same size, always. A comparison whose sides differ
             in width is not a comparison. */
          grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
          gap: var(--ac-sp);
          align-items: start;
        }
        .panel {
          display: flex;
          flex-direction: column;
          gap: var(--ac-sp-sm);
        }
        .panel-head {
          display: flex;
          align-items: baseline;
          gap: var(--ac-sp-xs);
          flex-wrap: wrap;
        }
        /* Mono is for identifiers a reader might retype — a version, a
           specifier. Prose captions are not code and do not get it. */
        .pill {
          padding: 0.05rem var(--ac-sp-xs);
          border-radius: 999px;
          background: color-mix(in srgb, var(--ac-ink) 7%, transparent);
          color: var(--ac-ink);
          font-family: var(--ac-mono);
          font-size: 0.75rem;
          white-space: nowrap;
        }
        .pill.is-new {
          background: color-mix(in srgb, var(--ac-accent) 12%, transparent);
          color: color-mix(in srgb, var(--ac-accent) 85%, var(--ac-ink));
        }
        .route {
          color: var(--ac-ink-2);
          font-size: 0.8125rem;
        }

        /* THE SUBJECT OF THE PAGE, so it is drawn as a real thing: a sunk
           surface with a hairline and a tag naming its own constraint. The
           dashed box it replaces said "placeholder". */
        .viewport {
          position: relative;
          overflow: hidden;
          height: 6.5rem;
          padding: var(--ac-sp) var(--ac-sp-sm) var(--ac-sp-sm);
          border-radius: var(--ac-radius-sm);
          background-color: var(--ac-sunk);
          box-shadow: inset 0 0 0 1px var(--ac-line);
        }
        .viewport-tag {
          position: absolute;
          top: 0;
          left: 0;
          padding: 0.1rem var(--ac-sp-xs);
          border-bottom-right-radius: var(--ac-radius-sm);
          background-color: color-mix(
            in srgb,
            var(--ac-ink) 6%,
            var(--ac-sunk)
          );
          color: var(--ac-ink-2);
          font-family: var(--ac-mono);
          font-size: 0.6875rem;
        }
        .field {
          display: grid;
          grid-template-columns: auto 1fr;
          align-items: center;
          gap: var(--ac-sp-sm);
          font-size: 0.8125rem;
        }
        .field-label {
          color: var(--ac-ink-2);
        }
        /* Same rule as the kit's embedded row: inside a stretching field the
           row decides the width, not the control's own floor. */
        .field > :not(.field-label) {
          min-width: 0;
          width: 100%;
        }

        .caption {
          max-width: 40ch;
          margin: 0;
          color: var(--ac-ink-2);
          font-size: 0.8125rem;
        }
        .caption strong {
          color: var(--ac-ink);
          font-weight: 600;
        }

        .stack h2 {
          margin: 0 0 var(--ac-sp-sm);
          font-size: 0.6875rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ac-ink-2);
        }
        .stack table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8125rem;
        }
        .stack th {
          padding: 0 var(--ac-sp-sm) var(--ac-sp-xs) 0;
          border-bottom: 1px solid var(--ac-line);
          color: var(--ac-ink-2);
          font-weight: 500;
          text-align: left;
          white-space: nowrap;
        }
        .stack td {
          padding: var(--ac-sp-xs) var(--ac-sp-sm) var(--ac-sp-xs) 0;
          border-bottom: 1px solid var(--ac-line);
          vertical-align: baseline;
        }
        .stack tr:last-child td {
          border-bottom: 0;
        }
        .c-layer {
          width: 1%;
          color: var(--ac-ink-2);
          font-family: var(--ac-mono);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .c-name {
          font-family: var(--ac-mono);
        }
        .c-version {
          width: 1%;
          white-space: nowrap;
        }
        .c-note {
          color: var(--ac-ink-2);
        }
        .owed {
          margin: var(--ac-sp-sm) 0 0;
          color: var(--ac-ink-2);
          font-size: 0.75rem;
        }

        code {
          padding: 0.05rem 0.25rem;
          border-radius: 0.25rem;
          background: color-mix(in srgb, var(--ac-ink) 6%, transparent);
          font-family: var(--ac-mono);
          font-size: 0.9em;
        }

        @container (max-width: 34rem) {
          .run {
            padding: var(--ac-sp);
          }
          .c-note {
            display: none;
          }
        }
      </style>
    </template>
  };
}
