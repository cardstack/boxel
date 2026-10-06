// Pretui — Marquee usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Marquee } from './marquee';

// ── Marquee ← fancy SimpleMarquee ────────────────────────────────────────
// Live knobs: speed (the original's baseVelocity, honest px/s),
// direction (left/right only — the vertical pair is not transcribed),
// pauseOnHover (replaces the original's slowdownOnHover + slowDownFactor
// spring). Dropped surface: easing fn, scroll-velocity coupling
// (useScrollVelocity/scrollAwareDirection/scrollSpringConfig), drag
// surface (draggable/dragSensitivity/dragVelocityDecay/dragAngle),
// repeat count (fixed at two copies).
const MARQUEE_DIRECTIONS = ['left', 'right'];

const MARQUEE_ITEMS = [
  'Marquee',
  'Comparison',
  'StackingCards',
  'Dock',
  'Panel',
  'Accordion',
  'SplitPanes',
  'Board',
];

class MarqueeUsage extends Component {
  directionOptions = MARQUEE_DIRECTIONS;
  items = MARQUEE_ITEMS;
  @tracked speed = 60;
  @tracked direction = 'left';
  @tracked pauseOnHover = true;
  setSpeed = (v: number | null) => (this.speed = v ?? 60);
  setDirection = (v: string) => (this.direction = v);
  setPauseOnHover = (v: boolean) => (this.pauseOnHover = v);
  get directionVal() {
    return this.direction as 'left' | 'right';
  }
  get usage() {
    let bits = [`@speed={{${this.speed}}}`];
    if (this.direction !== 'left') bits.push(`@direction='${this.direction}'`);
    if (this.pauseOnHover) bits.push('@pauseOnHover={{true}}');
    return `<Marquee ${bits.join(' ')}>\n  <span>…strip content…</span>\n</Marquee>`;
  }
  <template>
    <FreestyleUsage
      @name='Marquee'
      @description='Seamless drifting strip — content is rendered twice and a pure CSS keyframe loop translates the track half its width, so the seam never shows. Speed is honest px/s (a ResizeObserver measures the copy and computes the duration; the loop itself is CSS-only per the timer law). Gradient masks fade both edges. Under prefers-reduced-motion the loop stops and the strip becomes a static overflow row. Transcribed from fancy SimpleMarquee; the rAF motion-value engine (scroll coupling, drag inertia, easing) is deliberately not ported.'
      @source={{this.usage}}
    >
      <:example>
        <Marquee
          @speed={{this.speed}}
          @direction={{this.directionVal}}
          @pauseOnHover={{this.pauseOnHover}}
        >
          {{#each this.items as |item|}}
            <span class='marquee-chip'>{{item}}</span>
          {{/each}}
        </Marquee>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='speed'
          @defaultValue={{60}}
          @value={{this.speed}}
          @min={{10}}
          @max={{240}}
          @step={{10}}
          @description='Drift speed in px per second — converted to the CSS animation duration from the measured copy width.'
          @onInput={{this.setSpeed}}
        />
        <Args.String
          @name='direction'
          @defaultValue='left'
          @value={{this.direction}}
          @options={{this.directionOptions}}
          @description="Drift direction. 'right' reverses the keyframe loop; the vertical directions of the original are not transcribed."
          @onInput={{this.setDirection}}
        />
        <Args.Bool
          @name='pauseOnHover'
          @defaultValue={{false}}
          @value={{this.pauseOnHover}}
          @description="Pauses the loop while hovered (animation-play-state) — replaces the original's spring-smoothed slowdown."
          @onInput={{this.setPauseOnHover}}
        />
        <Args.Yield
          @description='Strip content — rendered twice for the seamless loop (second copy aria-hidden). Inter-item gap rides --pretui-marquee-gap so the seam spacing stays even.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .marquee-chip {
        flex: none;
        padding: 4px 12px;
        border-radius: 999px;
        background: var(--inset, var(--boxel-100));
        box-shadow: 0 0 0 1px var(--border);
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
    </style>
  </template>
}

export const DEMOS_MARQUEE: Record<string, unknown> = {
  Marquee: MarqueeUsage,
};
