// Pretui — CursorTrail: a trail of dots that follows the pointer.
import Component from '@glimmer/component';
import { hash } from '@ember/helper';
import { htmlSafe } from '@ember/template';
// Caller-supplied hues are strings and must clear the kit-wide allowlist
// before they reach an inline style — see pretui-css.gts.
import { cssDeclaration, cssNumber } from '../pretui-css';
import { pick, seedFrom } from '../examples';
import { pointerField } from '../internal/motion-pointer';

// ── CursorTrail ──────────────────────────────────────────────────────────
// TRANSCRIBED from motion-primitives Cursor + react-bits Blob/Ghost/
// Pixel/ImageTrail + fancy PixelTrail/ImageTrail.
//
// Upstream engines: motion-primitives springs one cursor node's x/y
// through useSpring on a document-level mousemove; react-bits' trails run
// a rAF loop over an array of past positions (some of them over a WebGL
// canvas); fancy's PixelTrail rAF-decays a grid of cell timestamps.
// Every one of them fades to literally nothing when the pointer leaves,
// and every one of them binds mousemove so touch gets no trail at all.
//
// This version: `pointerField` writes --pretui-px/py; the dots all target
// the SAME point and differ only in transition-duration, so dot i lags
// further behind under continuous retargeting — that graduated duration
// is the whole trail engine (see the header note on why transition-delay
// cannot do this job). Differences from the springs: no overshoot or
// wobble, and no per-dot physics — the fan is a pure ease-out ramp.
//
// Resting state (Law 8): the dots do not fade out. They converge on the
// last position, and because each is smaller and fainter than the last,
// the stack renders as a concentric bullseye — a legible attention marker
// in a still frame. Before any pointer arrives it parks at @restX/@restY.
// Encoding (Law 5): that marker is also the FOCUS marker — tab through the
// field's content and the bullseye travels to the focused child, so the
// trail states "here is the reader's attention point" on both input
// paths. Deterministic per-dot size jitter comes from seedFrom/pick.
const TRAIL_JITTER = [0, 0.05, -0.04, 0.03, -0.06, 0.02, -0.02, 0.06];

interface TrailDot {
  index: number;
  depth: number;
  style: ReturnType<typeof htmlSafe>;
}

export interface CursorTrailSignature {
  Args: {
    /** number of trailing marks, 1–24 — default 6 */
    count?: number;
    /** diameter of the head mark in px — default 14 */
    size?: number;
    /** seconds the LAST mark takes to reach the pointer; the fan is
     * linear from ~0.05s at the head to this — default 0.42 */
    lag?: number;
    /** any CSS color for the marks — defaults to the --primary token */
    hue?: string;
    /** mark geometry: 'dot' (filled), 'ring' (hairline), 'square' */
    shape?: 'dot' | 'ring' | 'square';
    /** seed string for the deterministic per-mark size jitter; omit for a
     * perfectly even fan (no Math.random anywhere) */
    seed?: string;
    /** move the marker to a focused child on focusin — default true; this
     * is the component's keyboard path, turn it off only if the field has
     * its own focus indicator */
    followFocus?: boolean;
    /** resting x origin as a fraction of the field's width — default 0.5 */
    restX?: number;
    /** resting y origin as a fraction of the field's height — default 0.5 */
    restY?: number;
  };
  Blocks: {
    /** the live field — content the trail rides over, fully interactive */
    default: [];
    /** replaces the default mark; yields { index, depth } where depth is
     * 0 at the head and 1 at the tail */
    mark: [{ index: number; depth: number }];
  };
  Element: HTMLDivElement;
}

export class CursorTrail extends Component<CursorTrailSignature> {
  get count(): number {
    let n = Math.round(this.args.count ?? 6);
    return Math.min(24, Math.max(1, Number.isFinite(n) ? n : 6));
  }
  get shape(): 'dot' | 'ring' | 'square' {
    return this.args.shape ?? 'dot';
  }
  get followFocus(): boolean {
    return this.args.followFocus ?? true;
  }
  get dots(): TrailDot[] {
    let count = this.count;
    let lag = this.args.lag ?? 0.42;
    if (!(lag >= 0)) lag = 0.42;
    let seed = this.args.seed ? seedFrom(this.args.seed) : 0;
    let out: TrailDot[] = [];
    for (let i = 0; i < count; i++) {
      let t = count > 1 ? i / (count - 1) : 0;
      let jitter = this.args.seed ? pick(seed, i, TRAIL_JITTER) : 0;
      let scale = Math.max(0.12, (1 - 0.58 * t) * (1 + jitter));
      let opacity = Math.max(0.08, 1 - 0.72 * t);
      let dur = 0.05 + lag * t;
      out.push({
        index: i,
        depth: t,
        style: htmlSafe(
          `--pretui-trail-scale: ${scale.toFixed(3)};` +
            ` --pretui-trail-opacity: ${opacity.toFixed(3)};` +
            ` --pretui-trail-dur: ${dur.toFixed(3)}s`,
        ),
      });
    }
    return out;
  }
  get rootStyle(): ReturnType<typeof htmlSafe> {
    let bits: string[] = [];
    {
      let n = cssNumber(this.args.size, 0, 10000);
      if (n !== undefined) {
        bits.push(`--pretui-trail-size: ${n}px`);
      }
    }
    let hue = cssDeclaration('--pretui-trail-hue', this.args.hue);
    if (hue) bits.push(hue);
    return htmlSafe(bits.join('; '));
  }
  <template>
    <div
      class='pretui-trail'
      style={{this.rootStyle}}
      data-test-pretui-cursor-trail
      {{pointerField 0 this.followFocus @restX @restY}}
      ...attributes
    >
      {{yield}}
      <div class='pretui-trail-layer' aria-hidden='true'>
        {{#each this.dots key='index' as |d|}}
          <span
            class='pretui-trail-mark'
            data-shape={{this.shape}}
            style={{d.style}}
          >
            {{#if (has-block 'mark')}}
              {{yield (hash index=d.index depth=d.depth) to='mark'}}
            {{/if}}
          </span>
        {{/each}}
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-trail {
          position: relative;
          border-radius: var(--pretui-trail-radius, var(--radius));
        }
        .pretui-trail-layer {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: inherit;
          pointer-events: none;
        }
        .pretui-trail-mark {
          position: absolute;
          top: 0;
          left: 0;
          display: block;
          width: var(--pretui-trail-size, 14px);
          height: var(--pretui-trail-size, 14px);
          margin-top: calc(var(--pretui-trail-size, 14px) / -2);
          margin-left: calc(var(--pretui-trail-size, 14px) / -2);
          opacity: var(--pretui-trail-opacity, 1);
          translate: var(--pretui-px, 0px) var(--pretui-py, 0px);
          scale: var(--pretui-trail-scale, 1);
          transition: translate var(--pretui-trail-dur, 0.2s)
            cubic-bezier(0.22, 1, 0.36, 1);
          will-change: translate;
        }
        .pretui-trail-mark[data-shape='dot'] {
          border-radius: 999px;
          background: color-mix(
            in oklch,
            var(--pretui-trail-hue, var(--primary)) 72%,
            transparent
          );
          box-shadow: 0 0 0 1px
            color-mix(
              in oklch,
              var(--pretui-trail-hue, var(--primary)) 26%,
              transparent
            );
        }
        .pretui-trail-mark[data-shape='ring'] {
          border-radius: 999px;
          background: transparent;
          box-shadow: inset 0 0 0 2px
            color-mix(
              in oklch,
              var(--pretui-trail-hue, var(--primary)) 78%,
              transparent
            );
        }
        .pretui-trail-mark[data-shape='square'] {
          border-radius: 2px;
          background: color-mix(
            in oklch,
            var(--pretui-trail-hue, var(--primary)) 68%,
            transparent
          );
        }
        /* end state under reduced motion: the marks track the pointer with
           no lag, i.e. the resting bullseye, never a frozen midpoint */
        @media (prefers-reduced-motion: reduce) {
          .pretui-trail-mark {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
