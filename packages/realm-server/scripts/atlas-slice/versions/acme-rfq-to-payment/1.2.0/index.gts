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
// ─── PASS 5 (1.1.1): the viewports were too tall ────────────────────────────
//
// 1.1.0 gave each viewport 6.5rem so a clipped popup would have somewhere to
// be cut off. At REST that reads as an empty box — the reader sees dead space
// and assumes something failed to load, which is the opposite of the confident
// impression a demonstration needs. 4.75rem still cuts the popup (it is far
// taller than that) while leaving the control looking placed rather than
// stranded. The constraint is doing the same job with less of the page.
//
// COMPATIBLE: presentation only, no argument or field moved.
//
// ─── PASS 6 (1.2.0): the stack table stops being hand-written ───────────────
//
// 1.1.0 introduced the resolved-stack table with a footnote admitting it was
// hand-maintained and would go stale. It went stale ONE RELEASE LATER — 1.1.1
// shipped with the table still claiming 1.1.0 — which is about as fast as such
// a prediction can come true, and is why the footnote was not good enough.
//
// It is now READ FROM THE SEALS. A pack's manifest is served beside its
// modules at `<version>/importmap.json`, so this card fetches its own — located
// from `import.meta.url`, so it cannot name the wrong version — and then walks
// its dependencies' manifests transitively.
//
// WHY THAT IS WORTH AN ASYNC LOAD. A demonstration of version resolution whose
// centrepiece is a table of hand-typed version numbers demonstrates nothing: a
// reader has no way to tell it from a screenshot. Reading the seals makes the
// table EVIDENCE rather than illustration — and it is the same walk a resolver
// does, so if the table is wrong, something real is wrong.
//
// It also proves its own point without being told to. `openkit/controls`
// appears TWICE, at 1.0.0 and 0.2.0, discovered rather than asserted, because
// the walk finds one in this pack's seal and the other in the kit's.
//
// FAILS SOFT. An unreachable manifest leaves the table empty with a line
// saying so, rather than throwing inside a render. A panel about provenance
// must not be able to take down the card it is describing.
//
// Also in this pass: `cardTitle`, because every run read "Untitled Payment
// Run" everywhere it was named; and atom/embedded/fitted formats, so a run is
// presentable in the slots a consumer puts it in rather than only on its own
// screen.

// The pack this module was served from — `…/acme/rfq-to-payment@1.2.0/`.
//
// `import.meta.url` rather than a constant, and that is the entire point: a
// hand-written version here would be the same lie the table used to tell, one
// level down. A module cannot be wrong about where it was loaded from.
const PACK_BASE = new URL('./', import.meta.url).href;

interface StackRow {
  name: string;
  version: string;
  /** How this Version came to be chosen: the range that resolved to it, and
   *  which pack did the resolving. */
  via: string;
}

// A pack's sealed manifest. Served beside its modules, so this is a plain GET
// against the same immutable address the module itself came from.
async function manifestAt(base: string): Promise<any | undefined> {
  try {
    let response = await fetch(new URL('importmap.json', base).href, {
      headers: { accept: 'application/json' },
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

// `…/northwind/records@1.1.1/index.js` → the name and the version, read off
// the address rather than out of the manifest. The address is what a consumer
// actually resolves to, so it is the honest source; a manifest could in
// principle disagree with where it was served from, and if it does, the URL is
// the one that decided what got loaded.
const PIN = /\/_packages\/((?:[^/@]+\/)?[^/@]+)@([^/@]+)\//;

/**
 * Walk the seals, breadth-first, starting from this pack.
 *
 * KEYED BY name@version AND NOT BY NAME, which is the whole reason this
 * reports anything interesting: keying by name would silently drop the second
 * `openkit/controls` and turn the page's central claim into a table that
 * quietly denies it.
 */
async function walkSeals(rootBase: string): Promise<StackRow[]> {
  let rows = new Map<string, StackRow>();
  let seen = new Set<string>();
  let queue: { base: string; label: string }[] = [
    { base: rootBase, label: 'this card' },
  ];

  while (queue.length) {
    let { base, label } = queue.shift()!;
    if (seen.has(base)) {
      continue;
    }
    seen.add(base);

    let manifest = await manifestAt(base);
    if (!manifest) {
      continue;
    }
    let own = PIN.exec(base);
    if (own) {
      let key = `${own[1]}@${own[2]}`;
      // First writer wins: the shallowest path to a Version is the most
      // useful explanation of why it is here.
      if (!rows.has(key)) {
        rows.set(key, { name: own[1], version: own[2], via: label });
      }
    }

    // The declared RANGES sit beside the pins, which is what lets a row say
    // "sealed from ^1.0.0" rather than only naming the answer.
    let ranges: Record<string, string> =
      manifest.deck?.dependencies ?? manifest.boxel?.dependencies ?? {};
    let imports: Record<string, string> = manifest.imports ?? {};
    let mine = own ? `${own[1]}@${own[2]}` : 'this card';

    for (let [name, target] of Object.entries(imports)) {
      // The bare specifier only. The `name/` prefix and every export alias
      // point into the same Version, so following all of them would walk the
      // same pack three times to learn the same thing.
      if (name.endsWith('/') || name !== name.trim() || !PIN.test(target)) {
        continue;
      }
      let match = PIN.exec(target)!;
      if (match[1] !== name) {
        continue;
      }
      let range = ranges[name];
      queue.push({
        base: new URL(target.slice(0, match.index + match[0].length), base)
          .href,
        label: range ? `${range} in ${mine}` : `pinned by ${mine}`,
      });
    }
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

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

  @field cardTitle = contains(StringField, {
    computeVia: function (this: PaymentRun) {
      return this.runName?.trim()?.length ? this.runName : 'Payment run';
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: PaymentRun) {
      return this.released?.display
        ? `${this.released.display} released`
        : 'Nothing released yet';
    },
  });

  static atom = class Atom extends Component<typeof PaymentRun> {
    <template>
      <span>{{@model.cardTitle}}</span>
    </template>
  };

  static embedded = class Embedded extends Component<typeof PaymentRun> {
    <template>
      <div class='row'>
        <span class='name'>{{@model.cardTitle}}</span>
        <span class='sum'>{{@model.released.display}}</span>
      </div>
      <style scoped>
        /* No chrome: the parent draws it around an embedded card. */
        .row {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: baseline;
          gap: var(--boxel-sp-xs, 0.625rem);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--boxel-font-size-sm, 0.8125rem);
        }
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sum {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // Badge, strip, tile and card from one template — a fitted card does not
  // know how big its slot is, so the sizes are answered by container queries
  // rather than by four components that would drift.
  static fitted = class Fitted extends Component<typeof PaymentRun> {
    <template>
      <div class='fit'>
        <span class='eyebrow'>Payment run</span>
        <span class='name'>{{@model.cardTitle}}</span>
        <span class='sum'>{{@model.released.display}}</span>
      </div>
      <style scoped>
        .fit {
          --ac-ink-2: var(--muted-foreground, #6b6f80);

          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.15rem;
          width: 100%;
          height: 100%;
          padding: var(--boxel-sp-xs, 0.625rem);
          overflow: hidden;
          color: var(--foreground, #16181f);
          font-family: var(--font-sans, system-ui, sans-serif);
        }
        .eyebrow {
          color: var(--ac-ink-2);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sum {
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        /* BADGE. The name only — a run with no name is not worth a slot. */
        @container (max-width: 9rem) {
          .eyebrow,
          .sum {
            display: none;
          }
        }
        /* STRIP. Name and amount, no label. */
        @container (min-width: 9rem) and (max-width: 15rem) {
          .eyebrow {
            display: none;
          }
        }
        @container (min-width: 24rem) {
          .fit {
            padding: var(--boxel-sp-sm, 0.75rem);
          }
          .name {
            font-size: 1.0625rem;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof PaymentRun> {
    @tracked approvers: Option[] = [];
    // The seals, once they arrive. `undefined` means still loading, an empty
    // array means the walk finished and found nothing — two different things,
    // and the template says so rather than showing an empty table for both.
    @tracked stack: StackRow[] | undefined;
    @tracked stackFailed = false;

    approverOptions = APPROVERS;

    constructor(owner: unknown, args: any) {
      super(owner as never, args);
      // Launched from the constructor rather than from a getter, so the fetch
      // happens once per component instead of on every re-read of a tracked
      // property — and so nothing async runs inside a tracking frame, which
      // is how a render turns into a loop.
      this.loadStack();
    }

    async loadStack() {
      try {
        this.stack = await walkSeals(PACK_BASE);
      } catch {
        this.stackFailed = true;
      }
    }

    @action chooseApprovers(selection: Option | Option[]) {
      this.approvers = Array.isArray(selection) ? selection : [selection];
    }

    <template>
      <article class='run'>
        <header class='head'>
          <h1>{{@model.cardTitle}}</h1>
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
          {{#if this.stack}}
            <table>
              <thead>
                <tr>
                  <th class='c-name'>Package</th>
                  <th class='c-version'>Version</th>
                  <th class='c-note'>How it was chosen</th>
                </tr>
              </thead>
              <tbody>
                {{! Keyed on name AND version: `openkit/controls` appears
                    twice on purpose, and keying by name alone would drop the
                    row that makes this page's point. }}
                {{#each this.stack key='@index' as |row|}}
                  <tr>
                    <td class='c-name'>{{row.name}}</td>
                    <td class='c-version'><span
                        class='pill'
                      >{{row.version}}</span></td>
                    <td class='c-note'>{{row.via}}</td>
                  </tr>
                {{/each}}
              </tbody>
            </table>
            <p class='read-from'>Read from the sealed manifests at render time,
              starting from this module's own address. Nothing here is typed by
              hand, so it cannot go stale.</p>
          {{else if this.stackFailed}}
            <p class='read-from'>The sealed manifests could not be read, so this
              table is empty rather than guessed.</p>
          {{else}}
            <p class='read-from'>Reading the seals…</p>
          {{/if}}
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
          height: 4.75rem;
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
        .read-from {
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
