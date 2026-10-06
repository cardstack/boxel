// Pretui — CursorTrail usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { CursorTrail } from './cursor-trail';
import { lots } from '../demo-motion-pointer';

// ── CursorTrail ──────────────────────────────────────────────────────────
const SHAPES = ['dot', 'ring', 'square'];

// three deterministic lot lines, shared by the trail and spotlight fields

class CursorTrailUsage extends Component {
  @tracked count = 6;
  @tracked size = 14;
  @tracked lag = 0.42;
  @tracked hue = '';
  @tracked shape: 'dot' | 'ring' | 'square' = 'dot';
  @tracked seed = 'wuyishan-spring';
  @tracked followFocus = true;
  @tracked restX = 0.5;
  @tracked restY = 0.5;
  shapeOptions = SHAPES;
  setCount = (v: number | null) => (this.count = v ?? 6);
  setSize = (v: number | null) => (this.size = v ?? 14);
  setLag = (v: number | null) => (this.lag = v ?? 0.42);
  setHue = (v: string) => (this.hue = v);
  setShape = (v: string) => {
    if (v === 'dot' || v === 'ring' || v === 'square') this.shape = v;
  };
  setSeed = (v: string) => (this.seed = v);
  setFollowFocus = (v: boolean) => (this.followFocus = v);
  setRestX = (v: number | null) => (this.restX = v ?? 0.5);
  setRestY = (v: number | null) => (this.restY = v ?? 0.5);
  get rows() {
    return lots('cursor-trail');
  }
  get usage() {
    let bits = [`@count={{${this.count}}}`, `@lag={{${this.lag}}}`];
    if (this.size !== 14) bits.push(`@size={{${this.size}}}`);
    if (this.shape !== 'dot') bits.push(`@shape='${this.shape}'`);
    if (this.hue) bits.push(`@hue='${this.hue}'`);
    if (this.seed) bits.push(`@seed='${this.seed}'`);
    if (!this.followFocus) bits.push('@followFocus={{false}}');
    return `<CursorTrail ${bits.join(' ')}>\n  … field content …\n</CursorTrail>`;
  }
  <template>
    <FreestyleUsage
      @name='CursorTrail'
      @description='A pointer-following marker over a live field. Upstream trails (motion-primitives Cursor, react-bits Blob/Ghost/Pixel/ImageTrail, fancy PixelTrail) run a rAF spring loop and fade to nothing when the pointer leaves; this one is a graduated CSS transition-duration fan with no loop, and it does not fade — the marks converge into a concentric bullseye at the last position, which is a legible attention marker in a still frame. Law 5 encoding: that marker is also the focus marker — Tab through the field below and it travels to the focused control, so it reports the reader’s attention point on both the pointer and keyboard paths. Touch drags move it too. Honest limit: while the pointer is moving the fan only exists in motion; the still frame gives you the marker, not the streak.'
      @source={{this.usage}}
    >
      <:example>
        <CursorTrail
          @count={{this.count}}
          @size={{this.size}}
          @lag={{this.lag}}
          @hue={{this.hue}}
          @shape={{this.shape}}
          @seed={{this.seed}}
          @followFocus={{this.followFocus}}
          @restX={{this.restX}}
          @restY={{this.restY}}
          class='trail-field'
        >
          <p class='trail-lede'>Spring bookings awaiting a cupping slot</p>
          <ul class='trail-list'>
            {{#each this.rows as |row|}}
              <li class='trail-row'>
                <Button @size='xs' @appearance='outlined'>{{row.tea}}</Button>
                <span class='trail-meta'>{{row.place}} · lot
                  {{row.lot}}</span>
              </li>
            {{/each}}
          </ul>
        </CursorTrail>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='count'
          @defaultValue={{6}}
          @value={{this.count}}
          @min={{1}}
          @max={{24}}
          @step={{1}}
          @description='Number of trailing marks, clamped 1–24. Mark 0 is the head; each subsequent mark is smaller, fainter and slower.'
          @onInput={{this.setCount}}
        />
        <Args.Number
          @name='size'
          @defaultValue={{14}}
          @value={{this.size}}
          @min={{4}}
          @max={{48}}
          @step={{1}}
          @description='Diameter of the head mark in px; the rest scale down from it.'
          @onInput={{this.setSize}}
        />
        <Args.Number
          @name='lag'
          @defaultValue={{0.42}}
          @value={{this.lag}}
          @min={{0}}
          @max={{1.5}}
          @step={{0.02}}
          @description='Seconds the LAST mark takes to reach the pointer. The fan ramps linearly from ~0.05s at the head. This is a transition duration, not a spring — nothing overshoots.'
          @onInput={{this.setLag}}
        />
        <Args.String
          @name='shape'
          @defaultValue='dot'
          @value={{this.shape}}
          @options={{this.shapeOptions}}
          @description='Mark geometry: filled dot, hairline ring, or square. For anything else use the :mark block.'
          @onInput={{this.setShape}}
        />
        <Args.String
          @name='hue'
          @value={{this.hue}}
          @description='Any CSS color for the marks. Empty falls back to the --primary token.'
          @onInput={{this.setHue}}
        />
        <Args.String
          @name='seed'
          @value={{this.seed}}
          @description='Seed string for the deterministic per-mark size jitter (seedFrom/pick — there is no Math.random in realm code). Empty gives a perfectly even fan.'
          @onInput={{this.setSeed}}
        />
        <Args.Bool
          @name='followFocus'
          @defaultValue={{true}}
          @value={{this.followFocus}}
          @description='Move the marker to a focused child on focusin. This is the component’s keyboard path — turn it off only if the field already has its own focus indicator.'
          @onInput={{this.setFollowFocus}}
        />
        <Args.Number
          @name='restX'
          @defaultValue={{0.5}}
          @value={{this.restX}}
          @min={{0}}
          @max={{1}}
          @step={{0.05}}
          @description='Resting x origin as a fraction of the field width — where the marker parks before anything has engaged.'
          @onInput={{this.setRestX}}
        />
        <Args.Number
          @name='restY'
          @defaultValue={{0.5}}
          @value={{this.restY}}
          @min={{0}}
          @max={{1}}
          @step={{0.05}}
          @description='Resting y origin as a fraction of the field height.'
          @onInput={{this.setRestY}}
        />
        <Args.Yield
          @name='default'
          @description='The live field. Content keeps all of its own pointer events — the mark layer is pointer-events: none and aria-hidden.'
        />
        <Args.Yield
          @name='mark'
          @description='Replaces the built-in mark. Yields { index, depth } where depth is 0 at the head and 1 at the tail, so a custom mark can scale itself.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-trail-radius'
          @type='length'
          @description='Corner radius of the field and of the clipping mark layer. Defaults to the --radius token.'
        />
        <Css.Basic
          @name='pretui-trail-hue'
          @type='color'
          @description='Same channel @hue writes to, for setting the color from a stylesheet instead of an arg.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .trail-field {
        padding: 18px;
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-card,
          0 0 0 1px var(--border),
          0 1px 3px rgb(16 24 40 / 0.06)
        );
      }
      .trail-lede {
        margin: 0 0 12px;
        font-size: var(--text-ui-md, 12.5px);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground);
      }
      .trail-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 8px;
      }
      .trail-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .trail-meta {
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_CURSOR_TRAIL: Record<string, unknown> = {
  CursorTrail: CursorTrailUsage,
};
