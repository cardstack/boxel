// Pretui — Spotlight: a light that follows the pointer across a surface.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
// Caller-supplied hues are strings and must clear the kit-wide allowlist
// before they reach an inline style — see pretui-css.gts.
import { cssDeclaration, cssNumber } from '../pretui-css';
import { pointerField } from '../internal/motion-pointer';

// ── Spotlight ────────────────────────────────────────────────────────────
// TRANSCRIBED from motion-primitives spotlight.tsx (and the highlight half
// of react-bits TargetCursor / ClickSpark).
//
// Upstream engine: a rAF spring drives left/top of an absolutely
// positioned blurred circle, and — the part that matters — the component
// REACHES INTO ITS PARENT on mount and mutates `parent.style.position`
// and `parent.style.overflow`. That is an invisible side effect on a node
// it does not own, and it is why the effect silently fails inside any
// parent that needs visible overflow. Its opacity is also 0 whenever the
// pointer is elsewhere, so a screenshot shows nothing at all, and its
// gradient is a `dark:` utility fork.
//
// This version owns its own surface: Spotlight IS the container (the
// relative/overflow contract is on a node it declares), the light is a
// fixed-size layer moved with `translate` — compositor-friendly, and
// transitionable, which `background-position` on a radial gradient is
// not — and the softness comes from a multi-stop gradient rather than
// `filter: blur()`, which is markedly cheaper on a large layer.
// Differences from the spring: linear ease-out travel, no overshoot.
// Dropped: `springOptions`, and the parent-mutation behavior entirely.
//
// Resting state (Law 8): @rest is a real opacity floor, not 0 — the wash
// parks at @restX/@restY so a still frame shows a lit surface rather than
// a blank one. Encoding (Law 5): the light travels to whatever child takes
// focus, so it reports which surface is live AND where focus sits — the
// keyboard path upstream never had.
// Honest limit: the surface clips its content (overflow: hidden), so a
// Spotlight cannot host a popover that needs to escape its box.
export interface SpotlightSignature {
  Args: {
    /** diameter of the light in px — default 260 */
    size?: number;
    /** any CSS color for the light — defaults to the --primary token */
    hue?: string;
    /** peak strength of the light at its centre, 0–1 — default 0.5 */
    intensity?: number;
    /** opacity floor when nothing is engaged, 0–1 — default 0.34. This is
     * the resting state; 0 makes the component invisible in a still frame */
    rest?: number;
    /** resting x origin as a fraction of the surface width — default 0.5 */
    restX?: number;
    /** resting y origin as a fraction of the surface height — default 0.5 */
    restY?: number;
    /** travel the light to a focused child on focusin — default true */
    followFocus?: boolean;
  };
  Blocks: {
    /** the lit surface's content — sits above the light, fully interactive */
    default: [];
  };
  Element: HTMLDivElement;
}

export class Spotlight extends Component<SpotlightSignature> {
  get followFocus(): boolean {
    return this.args.followFocus ?? true;
  }
  get rootStyle(): ReturnType<typeof htmlSafe> {
    let bits: string[] = [];
    {
      let n = cssNumber(this.args.size, 0, 10000);
      if (n !== undefined) {
        bits.push(`--pretui-spotlight-size: ${n}px`);
      }
    }
    let hue = cssDeclaration('--pretui-spotlight-hue', this.args.hue);
    if (hue) bits.push(hue);
    if (this.args.intensity !== undefined) {
      let pct = Math.round(
        Math.min(1, Math.max(0, this.args.intensity)) * 100,
      );
      bits.push(`--pretui-spotlight-strength: ${pct}%`);
    }
    {
      let n = cssNumber(this.args.rest, 0, 1);
      if (n !== undefined) {
        bits.push(`--pretui-spotlight-rest: ${n}`);
      }
    }
    return htmlSafe(bits.join('; '));
  }
  <template>
    <div
      class='pretui-spotlight'
      style={{this.rootStyle}}
      data-test-pretui-spotlight
      {{pointerField 0 this.followFocus @restX @restY}}
      ...attributes
    >
      <span class='pretui-spotlight-light' aria-hidden='true'></span>
      <div class='pretui-spotlight-content'>{{yield}}</div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-spotlight {
          position: relative;
          overflow: hidden;
          border-radius: var(--pretui-spotlight-radius, var(--radius));
          background: var(--pretui-spotlight-surface, var(--card));
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 3px rgb(16 24 40 / 0.06)
          );
        }
        .pretui-spotlight-light {
          position: absolute;
          top: 0;
          left: 0;
          display: block;
          width: var(--pretui-spotlight-size, 260px);
          height: var(--pretui-spotlight-size, 260px);
          margin-top: calc(var(--pretui-spotlight-size, 260px) / -2);
          margin-left: calc(var(--pretui-spotlight-size, 260px) / -2);
          pointer-events: none;
          border-radius: 999px;
          background: radial-gradient(
            circle at center,
            color-mix(
                in oklch,
                var(--pretui-spotlight-hue, var(--primary))
                  var(--pretui-spotlight-strength, 50%),
                transparent
              )
              0%,
            color-mix(
                in oklch,
                var(--pretui-spotlight-hue, var(--primary)) 14%,
                transparent
              )
              38%,
            color-mix(
                in oklch,
                var(--pretui-spotlight-hue, var(--primary)) 4%,
                transparent
              )
              64%,
            transparent 82%
          );
          opacity: var(--pretui-spotlight-rest, 0.34);
          translate: var(--pretui-px, 0px) var(--pretui-py, 0px);
          transition:
            translate 220ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 220ms ease-out;
          will-change: translate;
        }
        .pretui-spotlight[data-pretui-pointer='fine'] .pretui-spotlight-light,
        .pretui-spotlight[data-pretui-pointer='coarse'] .pretui-spotlight-light,
        .pretui-spotlight[data-pretui-pointer='focus'] .pretui-spotlight-light {
          opacity: 1;
        }
        .pretui-spotlight-content {
          position: relative;
        }
        /* end state under reduced motion: the light sits wherever the
           pointer/focus is, it just does not travel to get there */
        @media (prefers-reduced-motion: reduce) {
          .pretui-spotlight-light {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
