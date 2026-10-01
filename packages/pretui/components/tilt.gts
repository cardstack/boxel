// Pretui — Tilt: a surface that tilts in 3D toward the pointer.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
// Caller-supplied hues are strings and must clear the kit-wide allowlist
// before they reach an inline style — see pretui-css.gts.
import { cssNumber } from '../pretui-css';
import { pointerField } from '../internal/motion-pointer';

// ── Tilt ─────────────────────────────────────────────────────────────────
// TRANSCRIBED from motion-primitives tilt.tsx.
//
// Upstream engine: two springs feed useTransform ramps into a
// `perspective(1000px) rotateX() rotateY()` motion template, retargeted
// from React's onMouseMove. rotationFactor defaults to 15°, which reads as
// a toy. There is no resting treatment at all — the wrapper is a bare
// motion.div — no touch behavior, no keyboard behavior, and nothing in a
// still frame.
//
// HONEST ASSESSMENT, stated where a reader will find it: an idle tilt
// ENCODES NOTHING. Law 8 names it as the canonical cut. It ships because
// five kits converged on it, and it earns its place on two grounds, both
// of which are real in a still frame:
//   (a) @plate — the tilted thing is an actual Pretui surface (card
//       radius, --pretui-shadow-card at rest lifting to
//       --pretui-shadow-raised on engage). The screenshot shows an
//       elevated card, which is a component; the tilt is a garnish on it.
//   (b) @press — the plate tips toward the ACTUAL press point and sinks
//       slightly. That does encode a state transition: pressed, and here.
//       If you keep only one behavior of this component, keep that one.
// Everything else about it is decoration and is labelled so in the demo.
//
// This version: rotation is a `transform` calc over --pretui-nx/ny with a
// CSS transition. Differences from the spring: no overshoot on return.
// Default @max is 8°, not 15°. Dropped: `springOptions`, and `style`
// pass-through (…attributes covers it). Touch: coarse pointers get no
// rotation — a tilt under a fingertip is invisible and reads as drift —
// but keep the press response. Keyboard: focusin flattens the plate to
// neutral so a focused control is never read at an angle. Reduced motion:
// rotation is removed entirely (this is the most vestibular of the four),
// leaving the flat resting plate as the end state.
export interface TiltSignature {
  Args: {
    /** maximum rotation in degrees at the corners — default 8 (upstream's
     * 15 reads as a toy) */
    max?: number;
    /** invert the rotation, so the surface leans away from the pointer */
    reverse?: boolean;
    /** perspective depth in px — larger is flatter. Default 900 */
    perspective?: number;
    /** the moving specular sheen — default true */
    glare?: boolean;
    /** give the tilted thing a real Pretui card surface (radius +
     * elevation). Default true; this is the resting state that makes the
     * component visible in a still frame */
    plate?: boolean;
    /** tip toward and sink at the press point on pointerdown — default
     * true. This is the only part of Tilt that encodes anything */
    press?: boolean;
  };
  Blocks: {
    /** the tilted content */
    default: [];
  };
  Element: HTMLDivElement;
}

export class Tilt extends Component<TiltSignature> {
  get showGlare(): boolean {
    return this.args.glare ?? true;
  }
  get plate(): string {
    return (this.args.plate ?? true) ? 'true' : 'false';
  }
  get press(): string {
    return (this.args.press ?? true) ? 'true' : 'false';
  }
  get rootStyle(): ReturnType<typeof htmlSafe> {
    let bits = [`--pretui-tilt-sign: ${this.args.reverse ? -1 : 1}`];
    {
      let n = cssNumber(this.args.max, -360, 360);
      if (n !== undefined) {
        bits.push(`--pretui-tilt-max: ${n}`);
      }
    }
    {
      let n = cssNumber(this.args.perspective, 0, 100000);
      if (n !== undefined) {
        bits.push(`--pretui-tilt-perspective: ${n}px`);
      }
    }
    return htmlSafe(bits.join('; '));
  }
  <template>
    <div
      class='pretui-tilt'
      style={{this.rootStyle}}
      data-plate={{this.plate}}
      data-press={{this.press}}
      data-test-pretui-tilt
      {{pointerField 0 true 0.5 0.5}}
      ...attributes
    >
      <div class='pretui-tilt-plate'>
        {{yield}}
        {{#if this.showGlare}}
          <span class='pretui-tilt-glare' aria-hidden='true'></span>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .pretui-tilt {
        display: inline-block;
        perspective: var(--pretui-tilt-perspective, 900px);
      }
      .pretui-tilt-plate {
        position: relative;
        overflow: hidden;
        transform-style: preserve-3d;
        border-radius: var(--pretui-tilt-radius, var(--radius));
        transform: rotateX(
            calc(
              -2deg * var(--pretui-ny, 0) * var(--pretui-tilt-sign, 1) *
                var(--pretui-tilt-max, 8)
            )
          )
          rotateY(
            calc(
              2deg * var(--pretui-nx, 0) * var(--pretui-tilt-sign, 1) *
                var(--pretui-tilt-max, 8)
            )
          );
        transition:
          transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
          box-shadow 220ms ease-out,
          scale 140ms ease-out;
        will-change: transform;
      }
      .pretui-tilt[data-plate='true'] .pretui-tilt-plate {
        background: var(--pretui-tilt-surface, var(--card));
        box-shadow: var(
          --pretui-shadow-card,
          0 0 0 1px var(--border),
          0 1px 3px rgb(16 24 40 / 0.06)
        );
      }
      .pretui-tilt[data-plate='true'][data-pretui-pointer='fine']
        .pretui-tilt-plate,
      .pretui-tilt[data-plate='true'][data-pretui-pointer='focus']
        .pretui-tilt-plate {
        box-shadow: var(
          --pretui-shadow-raised,
          0 0 0 1px var(--border),
          0 2px 10px rgb(16 24 40 / 0.12)
        );
      }
      .pretui-tilt[data-press='true']:active .pretui-tilt-plate {
        scale: 0.985;
      }
      /* a fingertip cannot see a 3D lean, and the drift reads as a bug */
      .pretui-tilt[data-pretui-pointer='coarse'] .pretui-tilt-plate {
        transform: none;
      }
      .pretui-tilt-glare {
        position: absolute;
        top: -30%;
        left: -30%;
        width: 160%;
        height: 160%;
        pointer-events: none;
        background: radial-gradient(
          circle at center,
          color-mix(in oklch, var(--foreground) 4%, transparent) 0%,
          transparent 58%
        );
        translate: calc(var(--pretui-nx, 0) * 46%)
          calc(var(--pretui-ny, 0) * 46%);
        transition: translate 220ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      /* end state under reduced motion: a flat, elevated plate — the
         resting state, not a frozen mid-tilt */
      @media (prefers-reduced-motion: reduce) {
        .pretui-tilt-plate {
          transform: none;
          transition: box-shadow 220ms ease-out;
        }
        .pretui-tilt-glare {
          display: none;
        }
      }
    </style>
  </template>
}
