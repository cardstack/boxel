// Pretui — Comparison usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Comparison } from './comparison';

// ── Comparison ← wa-comparison + motion-primitives ImageComparison ───────
// Live knobs: value (wa's position, here controlled through
// @onValueChange) and label. Dropped surface: motion-primitives'
// springOptions and enableHover (hover-follow) modes — the seam tracks
// the pointer directly; wa's RTL mirroring and --divider-width /
// --handle-size cssVars rows (the channel is pinned to Pretui tokens;
// --pretui-comparison-seam-w / -handle-size remain for per-instance
// tuning).
class ComparisonUsage extends Component {
  @tracked value = 50;
  @tracked label = 'Before and after';
  handleValueChange = (v: number) => (this.value = v);
  setValue = (v: number | null) => (this.value = v ?? 50);
  setLabel = (v: string) => (this.label = v);
  get roundedValue() {
    return Math.round(this.value);
  }
  get usage() {
    return `<Comparison @value={{${this.roundedValue}}} @onValueChange={{this.handleValueChange}} @label='${this.label}'>\n  <:before>…</:before>\n  <:after>…</:after>\n</Comparison>`;
  }
  <template>
    <FreestyleUsage
      @name='Comparison'
      @description="Before/after split with a draggable seam — two full-bleed layers, the after layer clipped to the seam's percent position via clip-path. Drag the handle (pointer capture, no document listeners), or focus it and use arrows (shift for ±10, Home/End to jump): the handle carries role='slider' with live aria-valuenow, per wa-comparison's keyboard contract. No animation is involved — the seam tracks input directly, so reduced-motion needs nothing removed."
      @source={{this.usage}}
    >
      <:example>
        <div class='cmp-host'>
          <Comparison
            @value={{this.value}}
            @onValueChange={{this.handleValueChange}}
            @label={{this.label}}
          >
            <:before>
              <div class='cmp-layer cmp-layer-before'>
                <span class='cmp-tag'>Before</span>
                <p class='cmp-copy'>The unthemed wireframe — grayscale, flat,
                  no season on it.</p>
              </div>
            </:before>
            <:after>
              <div class='cmp-layer cmp-layer-after'>
                <span class='cmp-tag'>After</span>
                <p class='cmp-copy'>The Pretui cut — tokens, ink, and the
                  season's attention hue.</p>
              </div>
            </:after>
          </Comparison>
          <p class='cmp-note'>Seam at {{this.roundedValue}}%</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='value'
          @defaultValue={{50}}
          @value={{this.roundedValue}}
          @min={{0}}
          @max={{100}}
          @step={{1}}
          @description='Seam position as a 0–100 percent from the left. Pass it to control the seam; omit it for internal state.'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='label'
          @defaultValue='Comparison position'
          @value={{this.label}}
          @description='Accessible name for the seam slider handle.'
          @onInput={{this.setLabel}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Receives the next 0–100 value on every drag move, keystroke, or jump — reported for controlled and uncontrolled use alike.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='before'
          @description='Full-bleed before layer — sizes the host and shows to the RIGHT of the seam.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='after'
          @description='Full-bleed after layer — absolutely stacked and clipped to the LEFT of the seam.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .cmp-host {
        display: grid;
        gap: var(--space-3, 8px);
        max-width: 560px;
      }
      .cmp-layer {
        height: 220px;
        display: grid;
        align-content: end;
        gap: 4px;
        padding: var(--space-5, 16px);
      }
      .cmp-layer-before {
        background:
          repeating-linear-gradient(
            -45deg,
            transparent 0 10px,
            rgba(101, 106, 115, 0.08) 10px 11px
          ),
          var(--inset, var(--boxel-100));
        color: var(--muted-foreground);
      }
      .cmp-layer-after {
        background: linear-gradient(
          135deg,
          var(--primary),
          color-mix(in oklch, var(--primary) 55%, var(--boxel-dark))
        );
        color: var(--primary-foreground);
      }
      .cmp-tag {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
      }
      .cmp-copy {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        max-width: 34ch;
      }
      .cmp-note {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}

export const DEMOS_COMPARISON: Record<string, unknown> = {
  Comparison: ComparisonUsage,
};
