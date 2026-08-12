import {
  CardDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// Three versions of one field, and three versions of one component, on one
// page at the same time.
//
// This card exists to be LOOKED AT. Everything else in the slice is checked by
// asserting on an index row, and an index row cannot tell you that 0.1.0 prints
// `1200 USD` where 1.0.0 prints `$1,200.00` — which is the entire claim the
// versioning machinery is making. So the claim gets rendered.
//
// HOW THREE VERSIONS COEXIST. Each import below names a DIFFERENT specifier,
// and the realm's `importmap.json` maps each one to a different sealed
// Version:
//
//   "cardstack/contracts"        → /_packages/cardstack/contracts@1.0.0/index.js
//   "cardstack/contracts@0.1.0"  → /_packages/cardstack/contracts@0.1.0/index.js
//   "cardstack/contracts@0.2.0"  → /_packages/cardstack/contracts@0.2.0/index.js
//
// They are three separate modules at three separate URLs, so they are three
// separate classes with three separate templates, and nothing about loading one
// disturbs another. That is the property the whole design rests on and it is
// worth being able to see it rather than assert it.
import { MoneyField as MoneyV1 } from 'cardstack/contracts@0.1.0';
import { MoneyField as MoneyV2 } from 'cardstack/contracts@0.2.0';
import { MoneyField, PercentField } from 'cardstack/contracts';

import SelectV1 from 'openkit/controls@0.1.0';
import SelectV2 from 'openkit/controls@0.2.0';
import Select from 'openkit/controls';

import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

interface Option {
  key?: string;
  label: string;
  description?: string;
  disabled?: boolean;
  group?: string;
}

// One list, used by all three selects, so any difference on screen is a
// difference in the COMPONENT and never in its input. The diacritics and the
// groups are there because 0.2.0 claims to handle both and 0.1.0 does not.
const CURRENCIES: Option[] = [
  { key: 'USD', label: 'US dollar', description: 'USD · 2 minor units' },
  { key: 'EUR', label: 'Euro', description: 'EUR · 2 minor units' },
  { key: 'JPY', label: 'Japanese yen', description: 'JPY · no minor units' },
  {
    // A REAL diacritic, because the claim is that the filter folds them and a
    // fixture spelled without one tests nothing. Typing `mexico` must find
    // this row; typing `México` must find it too.
    key: 'MXN',
    label: 'Peso mexicano (México)',
    description: 'MXN · found by "mexico", no accent needed',
    group: 'Americas',
  },
  {
    key: 'BRL',
    label: 'Brazilian real',
    description: 'BRL · 2 minor units',
    group: 'Americas',
  },
  {
    key: 'CAD',
    label: 'Canadian dollar',
    description: 'CAD · 2 minor units',
    group: 'Americas',
  },
  {
    key: 'BYN',
    label: 'Belarusian ruble',
    description: 'BYN · ranks below USD for the query "us"',
    group: 'Europe',
  },
  {
    key: 'SEK',
    label: 'Swedish krona',
    description: 'SEK · symbol TRAILS the number',
    group: 'Europe',
  },
  {
    key: 'CHF',
    label: 'Swiss franc',
    description: 'CHF · 2 minor units',
    group: 'Europe',
  },
  {
    key: 'XAU',
    label: 'Gold (troy ounce)',
    description: 'Not spendable — here to be the disabled row',
    disabled: true,
    group: 'Not currencies',
  },
];

export class Showcase extends CardDef {
  static displayName = 'Version Showcase';
  // Six modules across two packages, three abreast. The grid reflows down to
  // one column, but the comparison only reads when the three sit side by side.
  static prefersWideFormat = true;

  @field title = contains(StringField);

  // The page's own headline, so this card stops being the one thing left in
  // the realm reporting itself as "Untitled".
  //
  // `title` and `cardTitle` are different names on purpose and both want
  // filling: `title` is the heading this card renders, `cardTitle` is what the
  // shell header, the browser tab and every link to this card read.
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Showcase) {
      return this.title?.trim()?.length ? this.title : 'Version showcase';
    },
  });

  // THE SAME NUMBER, THREE TIMES. Authored once per version because each is a
  // different class, but the values are kept identical in the instance — so
  // every visible difference below is the field's doing.
  @field priceAsPublished = contains(MoneyV1);
  @field priceIntl = contains(MoneyV2);
  @field price = contains(MoneyField);
  @field taxRate = contains(PercentField);

  static isolated = class Isolated extends Component<typeof Showcase> {
    // Three independent selections, so choosing in one does not move another —
    // otherwise a shared value would hide exactly the behaviour differences
    // this page exists to show.
    @tracked pickedV1: Option | undefined;
    @tracked pickedV2: Option | undefined;
    @tracked picked: Option[] = [];

    currencies = CURRENCIES;

    @action chooseV1(option: Option) {
      this.pickedV1 = option;
    }
    @action chooseV2(option: Option) {
      this.pickedV2 = option;
    }
    @action choose(selection: Option | Option[]) {
      this.picked = Array.isArray(selection) ? selection : [selection];
    }

    <template>
      <section class='showcase'>
        <header class='head'>
          <span class='eyebrow'>Atlas · cardstack/contracts · openkit/controls ·
            six modules, one page</span>
          <h1>{{if @model.title @model.title 'Version Showcase'}}</h1>
          <p class='lede'>
            Two packages, three sealed Versions each, all six modules loaded
            into this one page at the same time. Every difference below is the
            Version's doing: the inputs are identical.
          </p>
        </header>

        <div class='section-head'>
          <h2 class='rule'>cardstack/contracts — MoneyField</h2>
          <span class='rule-note'>same amount, three formatters</span>
        </div>
        <div class='grid'>
          <article class='cell'>
            <p class='tag'><span class='token'>0.1.0</span></p>
            <div class='stage'><@fields.priceAsPublished /></div>
            <p class='note'>Printed as written. No symbol, no grouping, no idea
              that yen has no minor units.</p>
          </article>
          <article class='cell'>
            <p class='tag'><span class='token'>0.2.0</span></p>
            <div class='stage'><@fields.priceIntl /></div>
            <p class='note'>One call to <code>Intl.NumberFormat</code> fixes the
              symbol, where the symbol goes, grouping, and the per-currency
              minor units — all at once.</p>
          </article>
          <article class='cell'>
            <p class='tag'><span class='token'>1.2.1</span></p>
            <div class='stage'><@fields.price /></div>
            <p class='note'>Theme variables throughout, five formats, and a
              percent sibling: <@fields.taxRate />
              1.2.0 took the house style — the input's edge is a hairline
              shadow with a soft inset, not a border — and 1.2.1 fixed the
              stamp it copied from 1.1.0 and forgot to change.</p>
          </article>
        </div>

        <div class='section-head'>
          <h2 class='rule'>openkit/controls — Select</h2>
          <span class='rule-note'>same option list, three components</span>
        </div>
        <div class='grid'>
          <article class='cell'>
            <p class='tag'><span class='token'>0.1.0</span></p>
            <div class='stage'>
              <SelectV1
                @options={{this.currencies}}
                @selected={{this.pickedV1}}
                @onChange={{this.chooseV1}}
                @label='Currency (0.1.0)'
                @placeholder='Pick a currency'
              />
            </div>
            <p class='note'>Full combobox ARIA and complete keyboard, but no
              search and no groups — and the popup is a DOM descendant, so an
              ancestor with <code>overflow: hidden</code> clips it.</p>
          </article>
          <article class='cell'>
            <p class='tag'><span class='token'>0.2.0</span></p>
            <div class='stage'>
              <SelectV2
                @options={{this.currencies}}
                @selected={{this.pickedV2}}
                @onChange={{this.chooseV2}}
                @label='Currency (0.2.0)'
                @placeholder='Pick a currency'
                @searchable={{true}}
                @searchPlaceholder='Try "peso", or "us"'
              />
            </div>
            <p class='note'>Search that ignores accents and RANKS its results,
              with the matched run marked; groups under sticky headers. Still
              clipped.</p>
          </article>
          <article class='cell'>
            <p class='tag'><span class='token'>1.1.0</span></p>
            <div class='stage'>
              <Select
                @options={{this.currencies}}
                @selected={{this.picked}}
                @onChange={{this.choose}}
                @label='Currencies (1.1.0)'
                @placeholder='Pick several'
                @searchable={{true}}
                @multiple={{true}}
                @searchPlaceholder='Try "peso", or "us"'
              />
            </div>
            <p class='note'>Portaled to
              <code>&lt;body&gt;</code>
              and anchored by floating-ui, so nothing clips it; multiple
              selection with chips; the highlight travels. 1.1.0 dropped the
              trigger's last border — the surface and the control that opens
              it now share one elevation ladder.</p>
          </article>
        </div>

        <div class='clip'>
          <p class='clip-label'>This box is
            <code>overflow: hidden</code>. Open each select inside it.</p>
          <div class='clip-row'>
            <SelectV1
              @options={{this.currencies}}
              @selected={{this.pickedV1}}
              @onChange={{this.chooseV1}}
              @label='0.1.0 inside a clipping box'
              @placeholder='0.1.0 — clipped'
            />
            <Select
              @options={{this.currencies}}
              @selected={{this.picked}}
              @onChange={{this.choose}}
              @label='1.1.0 inside a clipping box'
              @placeholder='1.1.0 — escapes'
              @searchable={{true}}
              @multiple={{true}}
            />
          </div>
        </div>
      </section>

      <style scoped>
        /* PretUI, taken from the realm theme rather than restated: every value
           below is an alias onto a theme token, so this card follows the
           app's light/dark switch instead of pinning its own. */
        .showcase {
          /* THIS page is about versions, so it opts in to the provenance
             stamps every field hides by default. One declaration here reaches
             every field on the page through inheritance — which is the whole
             reason it is a custom property and not an argument. */
          --boxel-provenance-display: inline;

          --sc-ink: var(--foreground, #1c1e26);
          --sc-ink-2: var(--muted-foreground, #6b6f80);
          --sc-ink-3: var(--ink-3, #9aa0b4);
          --sc-line: var(--border, #dfe1ea);
          --sc-surface: var(--card, #ffffff);
          --sc-sunk: var(--inset, #f5f6fa);
          --sc-accent: var(--pretui-primary-ink, var(--primary, #3d6bff));
          --sc-hairline: var(--pretui-shadow-hairline, 0 0 0 1px var(--sc-line));
          --sc-card: var(--pretui-shadow-card, 0 0 0 1px var(--sc-line));
          --sc-radius: var(--radius-surface, 10px);
          --sc-mono: var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace);
          --sc-serif: var(--font-serif, 'IBM Plex Serif', Georgia, serif);

          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: 26px 28px 34px;
          max-width: 1480px;
          margin: 0 auto;
          background-color: var(--background, var(--sc-surface));
          color: var(--sc-ink);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: 15px;
          letter-spacing: 0.01em;
          -webkit-font-smoothing: antialiased;
        }
        .eyebrow {
          font-family: var(--sc-mono);
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--sc-ink-2);
        }
        .head h1 {
          margin: 8px 0 0;
          font-family: var(--sc-serif);
          font-weight: 400;
          font-size: 40px;
          line-height: 1.06;
          letter-spacing: -0.015em;
        }
        .lede {
          margin: 10px 0 0;
          max-width: 68ch;
          font-size: 14px;
          line-height: 1.65;
          color: var(--sc-ink-2);
          text-wrap: pretty;
        }
        /* Law 1 — depth is one property. A hairline SHADOW rules the section
           off; no element in this card sets `border` for separation. */
        .section-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-top: 10px;
          padding-bottom: 8px;
          box-shadow: 0 1px 0 var(--sc-line);
        }
        .rule {
          margin: 0;
          font-family: var(--sc-mono);
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--sc-ink-2);
        }
        .rule-note {
          font-size: 11.5px;
          color: var(--sc-ink-3);
        }
        .grid {
          display: grid;
          /* auto-fit rather than a fixed count: this card is rendered in a
             stack item whose width the card does not control. */
          grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
          gap: 18px;
        }
        .cell {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .tag {
          margin: 0;
        }
        /* Law 3 — a Version is a machine value, so it wears the mono pill. */
        .token {
          display: inline-block;
          font-family: var(--sc-mono);
          font-size: 11.5px;
          font-weight: 500;
          padding: 1px 6px;
          border-radius: 5px;
          font-variant-numeric: tabular-nums;
          background: color-mix(in srgb, var(--primary, #3d6bff) 8%, var(--sc-surface));
          color: color-mix(in srgb, var(--sc-ink) 22%, var(--sc-accent));
          box-shadow: 0 0 0 1px
            color-mix(in srgb, var(--sc-accent) 28%, var(--sc-line));
        }
        .stage {
          display: flex;
          align-items: center;
          min-height: 3.25rem;
          padding: 12px 14px;
          border-radius: var(--sc-radius);
          background-color: var(--sc-surface);
          box-shadow: var(--sc-card);
        }
        .note {
          margin: 0;
          color: var(--sc-ink-2);
          font-size: 12.5px;
          line-height: 1.55;
          text-wrap: pretty;
        }
        code {
          font-family: var(--sc-mono);
          font-size: 0.9em;
        }
        /* The demonstration, not decoration: 0.1.0's listbox is cut off by this
           box and 1.0.0's is not, which is the whole reason 1.0.0 is a major.
           The dashed outline is INFORMATION — it says "this is a test rig" —
           which is the one case Law 1 leaves open for a drawn line. */
        .clip {
          margin-top: 10px;
          padding: 12px 14px;
          border-radius: var(--sc-radius);
          background: var(--sc-sunk);
          outline: 1px dashed var(--sc-line);
          outline-offset: -1px;
          overflow: hidden;
          max-height: 8rem;
        }
        .clip-label {
          margin: 0 0 10px;
          color: var(--sc-ink-2);
          font-size: 12.5px;
        }
        .clip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }
      </style>
    </template>
  };
}
