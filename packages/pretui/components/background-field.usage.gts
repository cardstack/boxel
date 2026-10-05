// Pretui — BackgroundField usage page. One knob rail drives the focus specimen and all nine catalogue tiles at once, so a single @hue change re-tints every field.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { BACKGROUND_FIELDS, BackgroundField } from './background-field';
import type { BackgroundFieldFade, BackgroundFieldName } from './background-field';
import { Chip } from './chip';
import { Token } from './token';
import { HUE_OPTIONS, hueArg } from '../demo-texture';

// ── BackgroundField ──────────────────────────────────────────────────────
const FADE_OPTIONS: BackgroundFieldFade[] = ['none', 'edges', 'bottom', 'top'];

class BackgroundFieldUsage extends Component {
  @tracked variant: BackgroundFieldName = 'mesh';
  @tracked animated = true;
  @tracked scale = 1;
  @tracked opacity = 1;
  @tracked speed = 1;
  @tracked hue = 'default';
  @tracked hue2 = 'default';
  @tracked hue3 = 'default';
  @tracked fade: BackgroundFieldFade = 'none';

  setVariant = (v: string) => (this.variant = v as BackgroundFieldName);
  selectVariant = (v: BackgroundFieldName) => (this.variant = v);
  setAnimated = (v: boolean) => (this.animated = v);
  setScale = (v: number | null) => (this.scale = v ?? 1);
  setOpacity = (v: number | null) => (this.opacity = v ?? 1);
  setSpeed = (v: number | null) => (this.speed = v ?? 1);
  setHue = (v: string) => (this.hue = v);
  setHue2 = (v: string) => (this.hue2 = v);
  setHue3 = (v: string) => (this.hue3 = v);
  setFade = (v: string) => (this.fade = v as BackgroundFieldFade);

  get fieldNames(): BackgroundFieldName[] {
    return BACKGROUND_FIELDS;
  }
  get hueOptions() {
    return HUE_OPTIONS;
  }
  get fadeOptions() {
    return FADE_OPTIONS;
  }
  // Selection state is computed here rather than compared in the template —
  // the kit ships no `eq` helper, and a getter keeps the tracked read honest.
  // `pressed` is a STRING because both consumers need an explicit "false":
  // `aria-pressed={{false}}` drops the attribute entirely, which reads as
  // "not a toggle button" rather than "an unpressed toggle button".
  get catalogue() {
    return BACKGROUND_FIELDS.map((name) => ({
      name,
      pressed: name === this.variant ? 'true' : 'false',
    }));
  }
  get hueValue() {
    return hueArg(this.hue);
  }
  get hue2Value() {
    return hueArg(this.hue2);
  }
  get hue3Value() {
    return hueArg(this.hue3);
  }
  get usage() {
    let bits = [`@variant='${this.variant}'`];
    if (this.animated) bits.push('@animated={{true}}');
    if (this.scale !== 1) bits.push(`@scale={{${this.scale}}}`);
    if (this.opacity !== 1) bits.push(`@opacity={{${this.opacity}}}`);
    if (this.speed !== 1) bits.push(`@speed={{${this.speed}}}`);
    if (this.hueValue) bits.push(`@hue='${this.hueValue}'`);
    if (this.hue2Value) bits.push(`@hue2='${this.hue2Value}'`);
    if (this.hue3Value) bits.push(`@hue3='${this.hue3Value}'`);
    if (this.fade !== 'none') bits.push(`@fade='${this.fade}'`);
    return `<BackgroundField ${bits.join(' ')}>\n  <h3>Spring lots · Wuyishan</h3>\n  <p>Da Hong Pao, first flush</p>\n</BackgroundField>`;
  }
  <template>
    <FreestyleUsage
      @name='BackgroundField'
      @description="One component, nine compiled ambient fields. Reach for it when a surface needs atmosphere — a hero band, an empty state, a dashboard header, a card that should feel like a place rather than a box. The painted stack is aria-hidden and pointer-events:none, so it is chrome and never content (Law 6); yielded children stack above it and stay fully interactive. Every field rides theme tokens through color-mix, so it re-tints with the season and with light/dark without a single dark branch — set a hue below and watch all nine change at once. Motion is CSS keyframes only (no shader, no canvas, no rAF), animates transform/opacity only, and stops dead under prefers-reduced-motion on a still resting state. Honest limits: the element has no intrinsic height, so you size it; grain is static whatever @animated says; and everything upstream that needs a shader or a particle integrator (Plasma, Galaxy, Iridescence, Dither, GridDistortion) is deliberately absent rather than faked."
      @source={{this.usage}}
    >
      <:example>
        <div class='bf-wrap'>
          <div class='bf-focus'>
            <BackgroundField
              class='bf-focus-paint'
              @variant={{this.variant}}
              @animated={{this.animated}}
              @scale={{this.scale}}
              @opacity={{this.opacity}}
              @speed={{this.speed}}
              @hue={{this.hueValue}}
              @hue2={{this.hue2Value}}
              @hue3={{this.hue3Value}}
              @fade={{this.fade}}
            >
              <div class='bf-copy'>
                <Chip @hue='var(--chart-2)'>Spring lots</Chip>
                <h3 class='bf-title'>Wuyishan · first flush</h3>
                <p class='bf-sub'>Da Hong Pao and Rou Gui from Junshan Estate
                  Direct, cupped and priced. Content sits above the field and
                  stays selectable — the paint never intercepts a pointer.</p>
                <p class='bf-meta'>Field
                  <Token @value={{this.variant}} />
                  · 2026-04-19</p>
              </div>
            </BackgroundField>
          </div>

          <div class='bf-cat'>
            <p class='bf-cat-head'>The catalogue — all nine on the same knobs.
              Pick one to focus it.</p>
            <ul class='bf-grid'>
              {{#each this.catalogue key='name' as |entry|}}
                <li class='bf-tile' data-selected={{entry.pressed}}>
                  <BackgroundField
                    class='bf-tile-paint'
                    @variant={{entry.name}}
                    @animated={{this.animated}}
                    @scale={{this.scale}}
                    @opacity={{this.opacity}}
                    @speed={{this.speed}}
                    @hue={{this.hueValue}}
                    @hue2={{this.hue2Value}}
                    @hue3={{this.hue3Value}}
                    @fade={{this.fade}}
                  />
                  <button
                    type='button'
                    class='bf-pick'
                    aria-pressed={{entry.pressed}}
                    {{on 'click' (fn this.selectVariant entry.name)}}
                  >{{entry.name}}</button>
                </li>
              {{/each}}
            </ul>
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='variant'
          @options={{this.fieldNames}}
          @value={{this.variant}}
          @onInput={{this.setVariant}}
          @defaultValue='dot-grid'
          @description='Which compiled field to paint — the one knob that replaces 55 separate upstream imports. Named variant rather than field because an Args key called field makes the realm lint endpoint inject a phantom card-api import and then fail on it (platform trap, not a design choice).'
        />
        <Args.Bool
          @name='animated'
          @value={{this.animated}}
          @onInput={{this.setAnimated}}
          @defaultValue={{false}}
          @description='Ambient motion on/off. Off by default — a background is chrome, and chrome that moves by default taxes every card that renders one. Grain is exempt: honest film grain needs per-frame noise, and a drifting noise tile reads as sliding sandpaper.'
        />
        <Args.Number
          @name='scale'
          @min={{0.25}}
          @max={{4}}
          @step={{0.25}}
          @value={{this.scale}}
          @onInput={{this.setScale}}
          @defaultValue={{1}}
          @description='Pattern size multiplier against the field’s natural cell (clamped 0.25–4). Drives --pretui-field-scale.'
        />
        <Args.Number
          @name='opacity'
          @min={{0}}
          @max={{1}}
          @step={{0.05}}
          @value={{this.opacity}}
          @onInput={{this.setOpacity}}
          @defaultValue={{1}}
          @description='Strength of the whole painted stack, applied once to the paint wrapper rather than per layer, so the layers keep their relative weighting. Drives --pretui-field-opacity.'
        />
        <Args.Number
          @name='speed'
          @min={{0.25}}
          @max={{4}}
          @step={{0.25}}
          @value={{this.speed}}
          @onInput={{this.setSpeed}}
          @defaultValue={{1}}
          @description='Motion rate multiplier (clamped 0.05–6); every field divides its own duration by it, so the layers within a field stay in their intended relationship. Ignored when @animated is false.'
        />
        <Args.String
          @name='hue'
          @options={{this.hueOptions}}
          @value={{this.hue}}
          @onInput={{this.setHue}}
          @defaultValue='var(--chart-1) — var(--foreground) for grain'
          @description='Primary field color. Any CSS color, or a token reference like var(--chart-4) — the token form is the point: it re-tints with the theme. “default” here means the arg is omitted entirely.'
        />
        <Args.String
          @name='hue2'
          @options={{this.hueOptions}}
          @value={{this.hue2}}
          @onInput={{this.setHue2}}
          @defaultValue='var(--chart-3)'
          @description='Secondary color, used by every field that layers two hues (dot-grid, line-grid, mesh, aurora, wave, beams, glow, stripes). Ignored by grain, which is a single layer.'
        />
        <Args.String
          @name='hue3'
          @options={{this.hueOptions}}
          @value={{this.hue3}}
          @onInput={{this.setHue3}}
          @defaultValue='var(--chart-2)'
          @description='Third color. Only mesh, aurora and wave compose a third layer; the other fields ignore it.'
        />
        <Args.String
          @name='fade'
          @options={{this.fadeOptions}}
          @value={{this.fade}}
          @onInput={{this.setFade}}
          @defaultValue='none'
          @description='Edge falloff masked over the whole painted stack: a soft vignette (edges) or a one-directional fade (bottom / top). Use it to hand a field back to the surface it sits on instead of ending at a hard rectangle.'
        />
        <Args.Yield
          @description='The default block stacks above the field in its own positioned layer. Omit it entirely and the component renders paint only — but then you must give the element a height, since the field has no intrinsic size.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .bf-wrap {
        display: grid;
        gap: var(--space-5, 15px);
      }
      /* radius lives on the wrapper; BackgroundField’s root inherits it, which
         is how the component is meant to be cornered — no override needed */
      .bf-focus {
        position: relative;
        border-radius: var(--radius-surface, 10px);
        box-shadow: 0 0 0 1px var(--border);
        overflow: hidden;
      }
      .bf-focus-paint {
        min-height: 200px;
        padding: var(--space-6, 19px);
        box-sizing: border-box;
      }
      .bf-copy {
        display: grid;
        gap: var(--space-2, 6px);
        justify-items: start;
        max-width: 46ch;
      }
      .bf-title {
        margin: 0;
        font-size: var(--text-heading, 19px);
        font-weight: var(--weight-heading, 700);
        letter-spacing: var(--track-heading, -0.02em);
        color: var(--foreground);
      }
      .bf-sub {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        line-height: 1.5;
        color: var(--muted-foreground);
      }
      .bf-meta {
        margin: 0;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .bf-cat-head {
        margin: 0 0 var(--space-3, 8px);
        font-size: var(--text-ui-xs, 11px);
        letter-spacing: var(--track-ui, 0.01em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .bf-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: var(--space-3, 8px);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .bf-tile {
        position: relative;
        border-radius: var(--radius-chip, 6px);
        box-shadow: 0 0 0 1px var(--border);
        overflow: hidden;
      }
      .bf-tile[data-selected='true'] {
        box-shadow: 0 0 0 2px var(--primary);
      }
      .bf-tile-paint {
        height: 92px;
      }
      /* the whole tile is one real button whose content is just the field
         name — the field itself never intercepts the pointer, so the target
         is the tile and the accessible name is the field */
      .bf-pick {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: flex-end;
        margin: 0;
        padding: var(--space-2, 6px) var(--space-3, 8px);
        border: 0;
        background: linear-gradient(
          to top,
          color-mix(in oklch, var(--card) 82%, transparent) 0%,
          transparent 58%
        );
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--foreground);
        cursor: pointer;
        text-align: left;
      }
      .bf-pick:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -2px;
      }
    </style>
  </template>
}

export const DEMOS_BACKGROUND_FIELD: Record<string, unknown> = {
  BackgroundField: BackgroundFieldUsage,
};
