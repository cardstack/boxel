// Pretui — Odometer usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Odometer } from './odometer';
import { LOCALES, NUMBER_STYLES } from '../demo-reading-format';

// ── Odometer ─────────────────────────────────────────────────────────────
const STAGGER_FROM = ['right', 'left'];
// Locales chosen to break naive formatters: RTL digits, a comma decimal
// separator, a lakh/crore grouping, and an East Asian compact scale.

// Law 5 names this as one of Pretui's two canonical motion mechanisms, and
// the law is specific: each digit is a 1ch window over a stacked 0–9
// column, and `offset > 5 → offset -= 10` so every digit takes the
// SHORTEST path around the ring — 9→0 rolls forward one, not backward
// nine. That shortest-path rule is the whole difference between "the
// number changed" and a slot machine. The example has to be interactive
// because a still Odometer is just a number.
class OdometerUsage extends Component {
  staggerFromOptions = STAGGER_FROM;
  styleOptions = NUMBER_STYLES;
  localeOptions = LOCALES;

  @tracked value = 128480;
  @tracked duration: number | null = 0.5;
  @tracked stagger: number | null = 0.03;
  @tracked staggerFrom = 'right';
  @tracked style = 'currency';
  @tracked currency = 'USD';
  @tracked cellHeight = '1em';

  setDuration = (v: number | null) => (this.duration = v);
  setStagger = (v: number | null) => (this.stagger = v);
  setStaggerFrom = (v: string) => (this.staggerFrom = v);
  setStyle = (v: string) => (this.style = v);
  setCurrency = (v: string) => (this.currency = v);
  setCellHeight = (v: string) => (this.cellHeight = v);
  setValue = (v: number | null) => (this.value = v ?? 0);

  // The carry cases that matter: +1 rolls one digit, +9 forces a cascade,
  // and the 9→0 wrap is where the shortest-path rule proves itself.
  bumpOne = (_e: Event) => (this.value = this.value + 1);
  bumpNine = (_e: Event) => (this.value = this.value + 9);
  bumpLot = (_e: Event) => (this.value = this.value + 4821);
  dropLot = (_e: Event) => (this.value = Math.max(0, this.value - 3607));
  wrap = (_e: Event) => (this.value = this.value + (9 - (this.value % 10)));

  get styleVal() {
    return this.style as 'decimal' | 'currency' | 'percent' | 'unit';
  }
  get staggerFromVal() {
    return this.staggerFrom as 'right' | 'left';
  }
  get durationVal() {
    return this.duration ?? undefined;
  }
  get staggerVal() {
    return this.stagger ?? undefined;
  }
  get usage() {
    let bits = [`@value={{${this.value}}}`];
    if (this.style !== 'decimal') bits.push(`@style='${this.style}'`);
    if (this.style === 'currency') bits.push(`@currency='${this.currency}'`);
    if (this.duration !== 0.5) bits.push(`@duration={{${this.duration}}}`);
    if (this.stagger !== 0.03) bits.push(`@stagger={{${this.stagger}}}`);
    if (this.staggerFrom !== 'right')
      bits.push(`@staggerFrom='${this.staggerFrom}'`);
    if (this.cellHeight !== '1em')
      bits.push(`@cellHeight='${this.cellHeight}'`);
    return `<Odometer ${bits.join(' ')} />`;
  }

  <template>
    <FreestyleUsage
      @name='Odometer'
      @description="A numeral that rolls when it changes — Law 5's canonical mechanism for motion that encodes a state transition rather than decorating one. Each digit is a window over a stacked 0–9 ring, and every digit takes the shortest path around it, so 9→0 rolls forward one step instead of spinning back nine. Motion is a CSS transition on a custom property (no timers, no animation engine); reduced motion snaps straight to the end state. The animated digits are aria-hidden with an sr-only real value beside them, and @announce defaults to off because a figure that moves on every tick would flood a screen reader. Stat composes this."
      @source={{this.usage}}
    >
      <:example>
        <div class='odo-stack'>
          <div class='odo-hero'>
            <Odometer
              @value={{this.value}}
              @style={{this.styleVal}}
              @currency={{this.currency}}
              @duration={{this.durationVal}}
              @stagger={{this.staggerVal}}
              @staggerFrom={{this.staggerFromVal}}
              @cellHeight={{this.cellHeight}}
            >
              <:after><span class='odo-suffix'>settled</span></:after>
            </Odometer>
          </div>
          <p class='odo-note'>Season total for
            <em>Alishan Cloud Farms</em>. Move it and watch the carry.</p>
          <div class='odo-controls'>
            <button type='button' class='odo-btn' {{on 'click' this.bumpOne}}>
              +1
            </button>
            <button type='button' class='odo-btn' {{on 'click' this.bumpNine}}>
              +9
            </button>
            <button type='button' class='odo-btn' {{on 'click' this.wrap}}>
              roll to 9
            </button>
            <button type='button' class='odo-btn' {{on 'click' this.bumpLot}}>
              +4,821
            </button>
            <button type='button' class='odo-btn' {{on 'click' this.dropLot}}>
              −3,607
            </button>
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='value'
          @value={{this.value}}
          @description='The value. A number is formatted through Intl; a string is used verbatim, so a pre-formatted value like $12,480 rolls too.'
          @onInput={{this.setValue}}
        />
        <Args.Number
          @name='duration'
          @defaultValue={{0.5}}
          @value={{this.duration}}
          @min={{0}}
          @max={{3}}
          @step={{0.05}}
          @description='Roll duration in seconds.'
          @onInput={{this.setDuration}}
        />
        <Args.Number
          @name='stagger'
          @defaultValue={{0.03}}
          @value={{this.stagger}}
          @min={{0}}
          @max={{0.3}}
          @step={{0.01}}
          @description='Seconds added per digit so the carry cascades. 0 rolls every digit together — which reads as a slot machine, not a carry.'
          @onInput={{this.setStagger}}
        />
        <Args.String
          @name='staggerFrom'
          @defaultValue='right'
          @value={{this.staggerFrom}}
          @options={{this.staggerFromOptions}}
          @description='Which end the stagger counts from. right means the units digit leads, which is the direction a real carry travels.'
          @onInput={{this.setStaggerFrom}}
        />
        <Args.String
          @name='cellHeight'
          @defaultValue='1em'
          @value={{this.cellHeight}}
          @description='Height of one digit cell, any CSS length. Sets the window the ring rolls behind.'
          @onInput={{this.setCellHeight}}
        />
        <Args.String
          @name='style'
          @defaultValue='decimal'
          @value={{this.style}}
          @options={{this.styleOptions}}
          @description='Intl style for numeric values — decimal, currency, percent, or unit.'
          @onInput={{this.setStyle}}
        />
        <Args.String
          @name='currency'
          @value={{this.currency}}
          @description='ISO 4217 code for style=currency; without it the style degrades to decimal.'
          @onInput={{this.setCurrency}}
        />
        <Args.String
          @name='ease'
          @description='CSS timing function for the roll. Defaults to a sprung cubic-bezier so the digit settles rather than stopping dead.'
        />
        <Args.String
          @name='announce'
          @defaultValue='off'
          @description='Live-region politeness for the sr-only value. off by default — a value that rolls on every tick would spam a screen reader. Use polite only where it settles at human pace.'
        />
        <Args.String
          @name='locale, minimum/maximumFractionDigits, useGrouping, options'
          @description='The Intl surface, matching FormatNumber.'
        />
        <Args.Yield
          @name='before / after'
          @description='Static content on either side of the digits, read aloud in order — a currency word, a unit, a label.'
        />
        <Args.String
          @name='placeholder'
          @defaultValue='—'
          @description='Rendered when the value is missing or non-finite.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .odo-stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-4, 14px);
      }
      .odo-hero {
        font-size: 33px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--foreground);
      }
      .odo-suffix {
        margin-left: var(--space-2, 6px);
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 500;
        color: var(--muted-foreground);
      }
      .odo-note {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
      .odo-note em {
        font-style: normal;
        font-weight: 600;
        color: var(--foreground);
      }
      .odo-controls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2, 6px);
      }
      .odo-btn {
        padding: 5px 10px;
        border: 0;
        border-radius: var(--radius-control, 7px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-control,
          0 0 0 1px var(--border)
        );
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        color: var(--foreground);
        cursor: pointer;
      }
      .odo-btn:hover {
        background: var(--muted);
      }
      .odo-btn:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
    </style>
  </template>
}

export const DEMOS_ODOMETER: Record<string, unknown> = {
  Odometer: OdometerUsage,
};
