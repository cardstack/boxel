// Pretui — BackgroundField: a decorative field of dots, grids or lines behind content.
import Component from '@glimmer/component';
import { clampNum, cssValue, styleFrom } from '../internal/texture';

// ── BackgroundField ──────────────────────────────────────────────────────

/** Every ambient field the catalogue compiles. */
export type BackgroundFieldName =
  | 'dot-grid'
  | 'line-grid'
  | 'mesh'
  | 'aurora'
  | 'wave'
  | 'beams'
  | 'glow'
  | 'stripes'
  | 'grain';

/** Catalogue order — the demo page and consumers iterate this. */
export const BACKGROUND_FIELDS: BackgroundFieldName[] = [
  'dot-grid',
  'line-grid',
  'mesh',
  'aurora',
  'wave',
  'beams',
  'glow',
  'stripes',
  'grain',
];

/** How the field fades out at its own edges. */
export type BackgroundFieldFade = 'none' | 'edges' | 'bottom' | 'top';

// How many paint layers each field composes. Rendering exactly the layers a
// field uses keeps the DOM (and the compositor's layer count) honest — an
// unused empty layer is cheap but not free, and this is the component that
// sits under everything.
const FIELD_LAYERS: Record<BackgroundFieldName, number[]> = {
  'dot-grid': [1, 2],
  'line-grid': [1, 2],
  mesh: [1, 2],
  aurora: [1, 2, 3],
  wave: [1, 2, 3],
  beams: [1, 2],
  glow: [1, 2],
  stripes: [1, 2],
  grain: [1],
};

export interface BackgroundFieldSignature {
  Args: {
    /** Which compiled field to paint — the one knob that replaces react-bits' 55 separate imports. (Named `variant`, not `field`: an Args key named `field` makes the realm's lint endpoint inject a phantom card-api `field` import and then fail on it. Platform trap, not a design choice.) */
    variant?: BackgroundFieldName;
    /** Ambient motion on/off. Off by default: a background is chrome, and chrome that moves by default is a tax on every card that renders one. `grain` is deliberately exempt — honest film grain needs per-frame noise, and a drifting static noise tile reads as sliding sandpaper, so grain stays still whatever this says. */
    animated?: boolean;
    /** Pattern size multiplier (1 = the field's natural cell). Drives `--pretui-field-scale`. */
    scale?: number;
    /** Overall strength of the whole painted stack, 0–1. Drives `--pretui-field-opacity`. */
    opacity?: number;
    /** Motion rate multiplier (1 = natural, 2 = twice as fast). Ignored when `@animated` is false. */
    speed?: number;
    /** Primary field color — any CSS color, or a token reference like `var(--chart-4)`. Defaults per field (charts for pattern fields, `--foreground` for grain). */
    hue?: string;
    /** Secondary color for the fields that layer two or three hues (mesh, aurora, wave, beams, glow). */
    hue2?: string;
    /** Third color, used by aurora / wave / mesh. */
    hue3?: string;
    /** Edge falloff of the painted stack: none, a soft vignette (`edges`), or a one-directional fade. */
    fade?: BackgroundFieldFade;
  };
  Blocks: {
    /** Content stacked above the field. The field paints behind it and never intercepts pointer events. */
    default: [];
  };
  Element: HTMLDivElement;
}

/**
 * One component, many compiled ambient fields.
 *
 * Paints a decorative field behind its content: dot grid, line grid, mesh
 * gradient, aurora, wave, beams, glow, stripes, grain. The paint layer is
 * `aria-hidden` and `pointer-events: none` — it is chrome, never content
 * (Law 6). Sizing comes from the caller (give the element a height, or let
 * the yielded content size it); the field fills whatever box it lands in and
 * inherits its border radius.
 *
 * Ported in behavior (never in code) from react-bits' Backgrounds category,
 * cult-ui's `bg-*` family and fancy's AnimatedGradientWithSvg. Dropped from
 * all three: every shader/particle field (needs an engine — Law 9), the
 * mouse-follow variants (a background that tracks the cursor fails the
 * screenshot test, Law 8), and the hardcoded palettes (replaced by tokens).
 */
export class BackgroundField extends Component<BackgroundFieldSignature> {
  get fieldVariant(): BackgroundFieldName {
    let f = this.args.variant;
    return f && FIELD_LAYERS[f] ? f : 'dot-grid';
  }
  get layers(): number[] {
    return FIELD_LAYERS[this.fieldVariant];
  }
  get fade(): BackgroundFieldFade {
    return this.args.fade ?? 'none';
  }
  get animated(): boolean {
    if (!this.args.animated) return false;
    let speed = this.args.speed ?? 1;
    return speed > 0;
  }
  get style() {
    let parts: string[] = [];
    let scale = clampNum(this.args.scale, 0.25, 4);
    if (scale !== undefined) parts.push(`--pretui-field-scale: ${scale}`);
    let opacity = clampNum(this.args.opacity, 0, 1);
    if (opacity !== undefined) parts.push(`--pretui-field-opacity: ${opacity}`);
    let speed = clampNum(this.args.speed, 0.05, 6);
    if (speed !== undefined) parts.push(`--pretui-field-speed: ${speed}`);
    let hue = cssValue(this.args.hue);
    if (hue) parts.push(`--pretui-field-hue: ${hue}`);
    let hue2 = cssValue(this.args.hue2);
    if (hue2) parts.push(`--pretui-field-hue-2: ${hue2}`);
    let hue3 = cssValue(this.args.hue3);
    if (hue3) parts.push(`--pretui-field-hue-3: ${hue3}`);
    return styleFrom(parts);
  }
  <template>
    <div
      class='pretui-field'
      data-field={{this.fieldVariant}}
      data-animated={{if this.animated 'true' 'false'}}
      data-fade={{this.fade}}
      style={{this.style}}
      data-test-pretui-background-field
      ...attributes
    >
      <div class='pretui-field-paint' aria-hidden='true'>
        {{#each this.layers as |n|}}
          <span class='pretui-field-l' data-l={{n}}></span>
        {{/each}}
      </div>
      {{#if (has-block)}}
        <div class='pretui-field-content'>{{yield}}</div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-field {
          position: relative;
          border-radius: inherit;
          /* derived from the one caller-facing size knob */
          --pretui-field-cell: calc(22px * var(--pretui-field-scale, 1));
          --pretui-field-tile: calc(120px * var(--pretui-field-scale, 1));
        }
        /* the paint wrapper clips the oversized layers — clipping here rather
           than on the root means yielded content is never cut off */
        .pretui-field-paint {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: inherit;
          pointer-events: none;
          z-index: 0;
          opacity: var(--pretui-field-opacity, 1);
        }
        .pretui-field-content {
          position: relative;
          z-index: 1;
        }
        /* Base rule IS the resting state: the float/sway keyframes read the
           same custom properties, so `animation: none` lands exactly here.

           The overhang invariant: a drifting layer travels `--pretui-field-dx/dy`
           and must stay covered for the whole trip, so each axis overhangs by at
           least the UNSIGNED drift distance (`--pretui-field-over-x/y`, declared
           alongside dx/dy on every drift layer). Without it a coarse tile in a
           short box — dot-grid layer 2 drifts 4 cells = 88px, a 240px-tall box
           only overhangs 60px — walks its own edge into view near the end of the
           cycle. `max()` rather than `+` so a tall box does not pay twice. */
        .pretui-field-l {
          position: absolute;
          inset: calc(-1 * max(25%, var(--pretui-field-over-y, 0px)))
            calc(-1 * max(25%, var(--pretui-field-over-x, 0px)));
          background-repeat: repeat;
          opacity: var(--pretui-field-o0, 1);
          transform: translate3d(
              var(--pretui-field-fx0, 0px),
              var(--pretui-field-fy0, 0px),
              0
            )
            scale(var(--pretui-field-s0, 1));
        }

        /* ── the three shared choreographies ─────────────────────────────── */
        /* seamless tile drift: dx/dy are always a whole number of tiles */
        @keyframes pretui-field-drift {
          from {
            transform: translate3d(0, 0, 0);
          }
          to {
            transform: translate3d(
              var(--pretui-field-dx, 0px),
              var(--pretui-field-dy, 0px),
              0
            );
          }
        }
        /* slow organic breathing for the gradient fields (alternate) */
        @keyframes pretui-field-float {
          from {
            opacity: var(--pretui-field-o0, 1);
            transform: translate3d(
                var(--pretui-field-fx0, 0px),
                var(--pretui-field-fy0, 0px),
                0
              )
              scale(var(--pretui-field-s0, 1));
          }
          to {
            opacity: var(--pretui-field-o1, 1);
            transform: translate3d(
                var(--pretui-field-fx1, 0px),
                var(--pretui-field-fy1, 0px),
                0
              )
              scale(var(--pretui-field-s1, 1));
          }
        }
        /* light-ray sweep (alternate) */
        @keyframes pretui-field-sway {
          from {
            transform: rotate(var(--pretui-field-r0, 0deg));
          }
          to {
            transform: rotate(var(--pretui-field-r1, 0deg));
          }
        }

        /* ── dot-grid ────────────────────────────────────────────────────── */
        .pretui-field[data-field='dot-grid'] .pretui-field-l[data-l='1'] {
          background-image: radial-gradient(
            circle at 50% 50%,
            color-mix(
                in oklch,
                var(--pretui-field-hue, var(--chart-1)) 55%,
                transparent
              )
              0 calc(1.6px * var(--pretui-field-scale, 1)),
            transparent calc(1.7px * var(--pretui-field-scale, 1))
          );
          background-size: var(--pretui-field-cell) var(--pretui-field-cell);
          --pretui-field-dx: var(--pretui-field-cell);
          --pretui-field-dy: var(--pretui-field-cell);
          --pretui-field-over-x: var(--pretui-field-cell);
          --pretui-field-over-y: var(--pretui-field-cell);
        }
        .pretui-field[data-field='dot-grid'] .pretui-field-l[data-l='2'] {
          background-image: radial-gradient(
            circle at 50% 50%,
            color-mix(
                in oklch,
                var(--pretui-field-hue-2, var(--chart-3)) 40%,
                transparent
              )
              0 calc(2.6px * var(--pretui-field-scale, 1)),
            transparent calc(2.7px * var(--pretui-field-scale, 1))
          );
          background-size: calc(var(--pretui-field-cell) * 4)
            calc(var(--pretui-field-cell) * 4);
          --pretui-field-dx: calc(var(--pretui-field-cell) * -4);
          --pretui-field-dy: calc(var(--pretui-field-cell) * 4);
          --pretui-field-over-x: calc(var(--pretui-field-cell) * 4);
          --pretui-field-over-y: calc(var(--pretui-field-cell) * 4);
        }
        .pretui-field[data-field='dot-grid'][data-animated='true']
          .pretui-field-l[data-l='1'] {
          animation: pretui-field-drift calc(34s / var(--pretui-field-speed, 1))
            linear infinite;
        }
        .pretui-field[data-field='dot-grid'][data-animated='true']
          .pretui-field-l[data-l='2'] {
          animation: pretui-field-drift calc(96s / var(--pretui-field-speed, 1))
            linear infinite;
        }

        /* ── line-grid (graph paper: minor cells + major every 5) ────────── */
        .pretui-field[data-field='line-grid'] .pretui-field-l[data-l='1'] {
          background-image: linear-gradient(
              to right,
              color-mix(
                  in oklch,
                  var(--pretui-field-hue, var(--chart-1)) 26%,
                  transparent
                )
                0 1px,
              transparent 1px
            ),
            linear-gradient(
              to bottom,
              color-mix(
                  in oklch,
                  var(--pretui-field-hue, var(--chart-1)) 26%,
                  transparent
                )
                0 1px,
              transparent 1px
            );
          background-size: var(--pretui-field-cell) var(--pretui-field-cell);
          --pretui-field-dx: var(--pretui-field-cell);
          --pretui-field-dy: var(--pretui-field-cell);
          --pretui-field-over-x: var(--pretui-field-cell);
          --pretui-field-over-y: var(--pretui-field-cell);
        }
        .pretui-field[data-field='line-grid'] .pretui-field-l[data-l='2'] {
          background-image: linear-gradient(
              to right,
              color-mix(
                  in oklch,
                  var(--pretui-field-hue-2, var(--chart-3)) 42%,
                  transparent
                )
                0 1px,
              transparent 1px
            ),
            linear-gradient(
              to bottom,
              color-mix(
                  in oklch,
                  var(--pretui-field-hue-2, var(--chart-3)) 42%,
                  transparent
                )
                0 1px,
              transparent 1px
            );
          background-size: calc(var(--pretui-field-cell) * 5)
            calc(var(--pretui-field-cell) * 5);
          --pretui-field-dx: calc(var(--pretui-field-cell) * 5);
          --pretui-field-dy: calc(var(--pretui-field-cell) * 5);
          --pretui-field-over-x: calc(var(--pretui-field-cell) * 5);
          --pretui-field-over-y: calc(var(--pretui-field-cell) * 5);
        }
        /* 5× the distance over 5× the duration = the two grids travel at one
           velocity and stay registered */
        .pretui-field[data-field='line-grid'][data-animated='true']
          .pretui-field-l[data-l='1'] {
          animation: pretui-field-drift calc(30s / var(--pretui-field-speed, 1))
            linear infinite;
        }
        .pretui-field[data-field='line-grid'][data-animated='true']
          .pretui-field-l[data-l='2'] {
          animation: pretui-field-drift calc(150s / var(--pretui-field-speed, 1))
            linear infinite;
        }

        /* ── mesh (soft multi-hue gradient blooms, no blur) ──────────────── */
        .pretui-field[data-field='mesh'] .pretui-field-l {
          inset: -22%;
          background-repeat: no-repeat;
          background-size: 100% 100%;
        }
        .pretui-field[data-field='mesh'] .pretui-field-l[data-l='1'] {
          background-image: radial-gradient(
              38% 46% at 22% 28%,
              color-mix(
                in oklch,
                var(--pretui-field-hue, var(--chart-1)) 48%,
                transparent
              )
                0%,
              transparent 72%
            ),
            radial-gradient(
              34% 40% at 78% 18%,
              color-mix(
                in oklch,
                var(--pretui-field-hue-2, var(--chart-3)) 42%,
                transparent
              )
                0%,
              transparent 70%
            );
          --pretui-field-fx1: -3%;
          --pretui-field-fy1: 2%;
          --pretui-field-s1: 1.08;
        }
        .pretui-field[data-field='mesh'] .pretui-field-l[data-l='2'] {
          background-image: radial-gradient(
              46% 44% at 62% 84%,
              color-mix(
                in oklch,
                var(--pretui-field-hue-3, var(--chart-2)) 40%,
                transparent
              )
                0%,
              transparent 74%
            ),
            radial-gradient(
              30% 34% at 12% 76%,
              color-mix(
                in oklch,
                var(--pretui-field-hue, var(--chart-1)) 30%,
                transparent
              )
                0%,
              transparent 72%
            );
          --pretui-field-fx1: 4%;
          --pretui-field-fy1: -3%;
          --pretui-field-s1: 1.06;
        }
        .pretui-field[data-field='mesh'][data-animated='true']
          .pretui-field-l[data-l='1'] {
          animation: pretui-field-float calc(19s / var(--pretui-field-speed, 1))
            ease-in-out infinite alternate;
        }
        .pretui-field[data-field='mesh'][data-animated='true']
          .pretui-field-l[data-l='2'] {
          animation: pretui-field-float calc(27s / var(--pretui-field-speed, 1))
            ease-in-out infinite alternate;
        }

        /* ── aurora (angled ribbons, top-weighted) ───────────────────────── */
        .pretui-field[data-field='aurora'] .pretui-field-l {
          inset: -18% -24%;
          background-repeat: no-repeat;
          background-size: 100% 100%;
          mask-image: linear-gradient(
            to bottom,
            rgb(0 0 0 / 1) 0%,
            rgb(0 0 0 / 1) 34%,
            rgb(0 0 0 / 0) 92%
          );
        }
        .pretui-field[data-field='aurora'] .pretui-field-l[data-l='1'] {
          background-image: linear-gradient(
            104deg,
            transparent 4%,
            color-mix(
                in oklch,
                var(--pretui-field-hue, var(--chart-1)) 42%,
                transparent
              )
              24%,
            transparent 44%
          );
          --pretui-field-fx1: 5%;
          --pretui-field-fy1: -2%;
          --pretui-field-s1: 1.05;
        }
        .pretui-field[data-field='aurora'] .pretui-field-l[data-l='2'] {
          background-image: linear-gradient(
            96deg,
            transparent 30%,
            color-mix(
                in oklch,
                var(--pretui-field-hue-2, var(--chart-3)) 38%,
                transparent
              )
              52%,
            transparent 74%
          );
          --pretui-field-fx1: -6%;
          --pretui-field-fy1: 2%;
          --pretui-field-s1: 1.07;
        }
        .pretui-field[data-field='aurora'] .pretui-field-l[data-l='3'] {
          background-image: linear-gradient(
            112deg,
            transparent 56%,
            color-mix(
                in oklch,
                var(--pretui-field-hue-3, var(--chart-2)) 34%,
                transparent
              )
              76%,
            transparent 96%
          );
          --pretui-field-fx1: 4%;
          --pretui-field-fy1: 3%;
          --pretui-field-s1: 1.04;
        }
        .pretui-field[data-field='aurora'][data-animated='true']
          .pretui-field-l[data-l='1'] {
          animation: pretui-field-float calc(17s / var(--pretui-field-speed, 1))
            ease-in-out infinite alternate;
        }
        .pretui-field[data-field='aurora'][data-animated='true']
          .pretui-field-l[data-l='2'] {
          animation: pretui-field-float calc(23s / var(--pretui-field-speed, 1))
            ease-in-out infinite alternate;
        }
        .pretui-field[data-field='aurora'][data-animated='true']
          .pretui-field-l[data-l='3'] {
          animation: pretui-field-float calc(31s / var(--pretui-field-speed, 1))
            ease-in-out infinite alternate;
        }

        /* ── wave (three SVG crests, masked so the HUE stays token-driven) ─ */
        .pretui-field[data-field='wave'] .pretui-field-l {
          top: 0;
          bottom: 0;
          left: calc(-1.5 * var(--pretui-field-tile));
          right: calc(-1.5 * var(--pretui-field-tile));
          mask-repeat: repeat-x;
          mask-position: left bottom;
          mask-image: url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 120 28%27 preserveAspectRatio=%27none%27%3E%3Cpath d=%27M0 16 C 20 4 40 4 60 16 S 100 28 120 16 L 120 28 L 0 28 Z%27 fill=%27black%27/%3E%3C/svg%3E');
        }
        .pretui-field[data-field='wave'] .pretui-field-l[data-l='1'] {
          background-color: color-mix(
            in oklch,
            var(--pretui-field-hue, var(--chart-1)) 30%,
            transparent
          );
          mask-size: var(--pretui-field-tile)
            calc(var(--pretui-field-tile) * 0.34);
          --pretui-field-dx: var(--pretui-field-tile);
        }
        .pretui-field[data-field='wave'] .pretui-field-l[data-l='2'] {
          background-color: color-mix(
            in oklch,
            var(--pretui-field-hue-2, var(--chart-3)) 24%,
            transparent
          );
          bottom: calc(var(--pretui-field-tile) * 0.07);
          mask-size: calc(var(--pretui-field-tile) * 1.4)
            calc(var(--pretui-field-tile) * 0.42);
          --pretui-field-dx: calc(var(--pretui-field-tile) * -1.4);
        }
        .pretui-field[data-field='wave'] .pretui-field-l[data-l='3'] {
          background-color: color-mix(
            in oklch,
            var(--pretui-field-hue-3, var(--chart-2)) 18%,
            transparent
          );
          bottom: calc(var(--pretui-field-tile) * 0.15);
          mask-size: calc(var(--pretui-field-tile) * 0.75)
            calc(var(--pretui-field-tile) * 0.26);
          --pretui-field-dx: calc(var(--pretui-field-tile) * 0.75);
        }
        .pretui-field[data-field='wave'][data-animated='true']
          .pretui-field-l[data-l='1'] {
          animation: pretui-field-drift calc(21s / var(--pretui-field-speed, 1))
            linear infinite;
        }
        .pretui-field[data-field='wave'][data-animated='true']
          .pretui-field-l[data-l='2'] {
          animation: pretui-field-drift calc(34s / var(--pretui-field-speed, 1))
            linear infinite;
        }
        .pretui-field[data-field='wave'][data-animated='true']
          .pretui-field-l[data-l='3'] {
          animation: pretui-field-drift calc(15s / var(--pretui-field-speed, 1))
            linear infinite;
        }

        /* ── beams (light rays from a point above the top edge) ──────────── */
        .pretui-field[data-field='beams'] .pretui-field-l {
          inset: -12% -60% -45%;
          transform-origin: 50% 0%;
          transform: rotate(var(--pretui-field-r0, 0deg));
          mask-image: linear-gradient(
            to bottom,
            rgb(0 0 0 / 1) 0%,
            rgb(0 0 0 / 0) 72%
          );
        }
        .pretui-field[data-field='beams'] .pretui-field-l[data-l='1'] {
          background-image: repeating-conic-gradient(
            from -22deg at 50% 0%,
            transparent 0deg 4deg,
            color-mix(
                in oklch,
                var(--pretui-field-hue, var(--chart-1)) 26%,
                transparent
              )
              4deg 6deg,
            transparent 6deg 11deg
          );
          --pretui-field-r0: -4deg;
          --pretui-field-r1: 4deg;
        }
        .pretui-field[data-field='beams'] .pretui-field-l[data-l='2'] {
          background-image: repeating-conic-gradient(
            from -14deg at 50% 0%,
            transparent 0deg 7deg,
            color-mix(
                in oklch,
                var(--pretui-field-hue-2, var(--chart-3)) 18%,
                transparent
              )
              7deg 9deg,
            transparent 9deg 19deg
          );
          --pretui-field-r0: 3deg;
          --pretui-field-r1: -3deg;
        }
        .pretui-field[data-field='beams'][data-animated='true']
          .pretui-field-l[data-l='1'] {
          animation: pretui-field-sway calc(24s / var(--pretui-field-speed, 1))
            ease-in-out infinite alternate;
        }
        .pretui-field[data-field='beams'][data-animated='true']
          .pretui-field-l[data-l='2'] {
          animation: pretui-field-sway calc(33s / var(--pretui-field-speed, 1))
            ease-in-out infinite alternate;
        }

        /* ── glow (two soft orbs, breathing) ─────────────────────────────── */
        .pretui-field[data-field='glow'] .pretui-field-l {
          inset: -20%;
          background-repeat: no-repeat;
          background-size: 100% 100%;
        }
        .pretui-field[data-field='glow'] .pretui-field-l[data-l='1'] {
          background-image: radial-gradient(
            40% 42% at 32% 26%,
            color-mix(
              in oklch,
              var(--pretui-field-hue, var(--chart-1)) 52%,
              transparent
            )
              0%,
            transparent 72%
          );
          --pretui-field-o0: 0.9;
          --pretui-field-o1: 1;
          --pretui-field-s1: 1.12;
        }
        .pretui-field[data-field='glow'] .pretui-field-l[data-l='2'] {
          background-image: radial-gradient(
            36% 38% at 74% 72%,
            color-mix(
              in oklch,
              var(--pretui-field-hue-2, var(--chart-3)) 44%,
              transparent
            )
              0%,
            transparent 74%
          );
          --pretui-field-o0: 1;
          --pretui-field-o1: 0.82;
          --pretui-field-s1: 1.1;
        }
        .pretui-field[data-field='glow'][data-animated='true']
          .pretui-field-l[data-l='1'] {
          animation: pretui-field-float calc(13s / var(--pretui-field-speed, 1))
            ease-in-out infinite alternate;
        }
        .pretui-field[data-field='glow'][data-animated='true']
          .pretui-field-l[data-l='2'] {
          animation: pretui-field-float calc(18s / var(--pretui-field-speed, 1))
            ease-in-out infinite alternate;
        }

        /* ── stripes (45° hatching, two frequencies at one velocity) ─────── */
        .pretui-field[data-field='stripes'] .pretui-field-l[data-l='1'] {
          background-image: repeating-linear-gradient(
            45deg,
            color-mix(
                in oklch,
                var(--pretui-field-hue, var(--chart-1)) 22%,
                transparent
              )
              0 calc(var(--pretui-field-cell) * 0.3),
            transparent calc(var(--pretui-field-cell) * 0.3)
              var(--pretui-field-cell)
          );
          --pretui-field-dx: calc(var(--pretui-field-cell) * 1.41421);
          --pretui-field-over-x: calc(var(--pretui-field-cell) * 1.41421);
        }
        .pretui-field[data-field='stripes'] .pretui-field-l[data-l='2'] {
          background-image: repeating-linear-gradient(
            45deg,
            color-mix(
                in oklch,
                var(--pretui-field-hue-2, var(--chart-3)) 16%,
                transparent
              )
              0 calc(var(--pretui-field-cell) * 0.5),
            transparent calc(var(--pretui-field-cell) * 0.5)
              calc(var(--pretui-field-cell) * 3)
          );
          --pretui-field-dx: calc(var(--pretui-field-cell) * 4.24264);
          --pretui-field-over-x: calc(var(--pretui-field-cell) * 4.24264);
        }
        .pretui-field[data-field='stripes'][data-animated='true']
          .pretui-field-l[data-l='1'] {
          animation: pretui-field-drift calc(26s / var(--pretui-field-speed, 1))
            linear infinite;
        }
        .pretui-field[data-field='stripes'][data-animated='true']
          .pretui-field-l[data-l='2'] {
          animation: pretui-field-drift calc(78s / var(--pretui-field-speed, 1))
            linear infinite;
        }

        /* ── grain (feTurbulence used as a MASK over a token color, so the
           speckle is ink in light themes and light in dark themes — upstream
           ships a baked white/black PNG and needs a dark fork) ──────────── */
        .pretui-field[data-field='grain'] .pretui-field-l[data-l='1'] {
          inset: 0;
          background-color: var(--pretui-field-hue, var(--foreground));
          mask-repeat: repeat;
          mask-size: calc(180px * var(--pretui-field-scale, 1))
            calc(180px * var(--pretui-field-scale, 1));
          mask-image: url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27180%27 height=%27180%27%3E%3Cfilter id=%27g%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%273%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27180%27 height=%27180%27 filter=%27url(%23g)%27/%3E%3C/svg%3E');
          --pretui-field-o0: 0.42;
        }

        /* ── edge falloff (applied to the whole painted stack) ───────────── */
        .pretui-field[data-fade='edges'] .pretui-field-paint {
          mask-image: radial-gradient(
            118% 118% at 50% 50%,
            rgb(0 0 0 / 1) 38%,
            rgb(0 0 0 / 0) 100%
          );
        }
        .pretui-field[data-fade='bottom'] .pretui-field-paint {
          mask-image: linear-gradient(
            to bottom,
            rgb(0 0 0 / 1) 30%,
            rgb(0 0 0 / 0) 100%
          );
        }
        .pretui-field[data-fade='top'] .pretui-field-paint {
          mask-image: linear-gradient(
            to top,
            rgb(0 0 0 / 1) 30%,
            rgb(0 0 0 / 0) 100%
          );
        }

        /* Law 5: the resting state is the base rule, so killing the animation
           lands on a still, deliberate field — never a frozen midpoint. */
        @media (prefers-reduced-motion: reduce) {
          .pretui-field-l {
            animation: none;
          }
        }
      }
    </style>
  </template>
}
