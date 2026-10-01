// Pretui — Magnetic: content that leans toward the pointer as it approaches.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
// Caller-supplied hues are strings and must clear the kit-wide allowlist
// before they reach an inline style — see pretui-css.gts.
import { cssDeclaration, cssNumber } from '../pretui-css';
import { pointerField } from '../internal/motion-pointer';

// ── Magnetic ─────────────────────────────────────────────────────────────
// TRANSCRIBED from motion-primitives magnetic.tsx and react-bits
// Magnet/MagnetLines.
//
// Upstream engine: a document-level mousemove handler measures the
// element every event, computes distance, scales by (1 - d/range), and
// pushes the result through useSpring (stiffness 26.7 / damping 4.1 /
// mass 0.2 — deliberately underdamped, so the element wobbles). Range is
// an invisible number: nothing on screen tells the reader where the pull
// starts, and a still frame of the component is just… the button.
//
// This version: the range is REAL LAYOUT. The wrapper reserves it as
// padding, so the reach zone is a box the pointer actually enters — which
// means one pointermove listener on the wrapper replaces the global one,
// and the zone can be DRAWN. That drawn halo is the resting state and the
// encoding both: it is a picture of the control's true (enlarged) hit
// area, and it brightens with --pretui-pd as the pointer closes in, so
// affinity is legible before anything moves. Lean is
// --pretui-dx/dy × @intensity on a `translate` transition. Differences
// from the spring: critically damped — it eases home and stops, no
// wobble, no stiffness/damping/mass surface. Dropped from upstream:
// `actionArea: 'self' | 'parent' | 'global'` (the padded zone IS the
// action area; a global magnet that reacts from across the page is the
// behavior that most reliably reads as a bug) and `springOptions`.
//
// Touch: coarse pointers get the halo but no lean — pulling an element
// out from under a fingertip is only ever a miss. Keyboard: focusing the
// wrapped control lights the halo to full via focusin, so the reach
// affordance appears on the keyboard path too (upstream: nothing).
export interface MagneticSignature {
  Args: {
    /** reach in px, reserved as real padding around the control — this is
     * the extra hit area the halo draws. Default 56 */
    range?: number;
    /** how far the control leans toward the pointer, as a fraction of the
     * falloff-scaled offset, 0–1 — default 0.35 */
    intensity?: number;
    /** draw the reach zone (the resting state) — default true. Turning it
     * off makes the component invisible in a still frame; do it only when
     * a neighbouring affordance already shows the target */
    halo?: boolean;
    /** any CSS color for the halo — defaults to the --primary token */
    hue?: string;
  };
  Blocks: {
    /** the control being magnetized — keeps all of its own events */
    default: [];
  };
  Element: HTMLDivElement;
}

export class Magnetic extends Component<MagneticSignature> {
  get showHalo(): boolean {
    return this.args.halo ?? true;
  }
  get rootStyle(): ReturnType<typeof htmlSafe> {
    let bits: string[] = [];
    {
      let n = cssNumber(this.args.range, 0, 10000);
      if (n !== undefined) {
        bits.push(`--pretui-magnetic-range: ${n}px`);
      }
    }
    {
      let n = cssNumber(this.args.intensity, -100, 100);
      if (n !== undefined) {
        bits.push(`--pretui-magnetic-intensity: ${n}`);
      }
    }
    let hue = cssDeclaration('--pretui-magnetic-hue', this.args.hue);
    if (hue) bits.push(hue);
    return htmlSafe(bits.join('; '));
  }
  <template>
    <div
      class='pretui-magnetic'
      style={{this.rootStyle}}
      data-test-pretui-magnetic
      {{pointerField 0 true 0.5 0.5}}
      ...attributes
    >
      {{#if this.showHalo}}
        <span class='pretui-magnetic-halo' aria-hidden='true'></span>
      {{/if}}
      <span class='pretui-magnetic-lean'>{{yield}}</span>
    </div>
    <style scoped>
      .pretui-magnetic {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--pretui-magnetic-range, 56px);
      }
      .pretui-magnetic-halo {
        position: absolute;
        inset: 0;
        pointer-events: none;
        border-radius: var(--pretui-magnetic-halo-radius, 999px);
        background: radial-gradient(
          circle at center,
          color-mix(
              in oklch,
              var(--pretui-magnetic-hue, var(--primary)) 16%,
              transparent
            )
            0%,
          color-mix(
              in oklch,
              var(--pretui-magnetic-hue, var(--primary)) 5%,
              transparent
            )
            48%,
          transparent 72%
        );
        box-shadow: 0 0 0 1px
          color-mix(in oklch, var(--border) 70%, transparent);
        opacity: calc(0.34 + 0.66 * var(--pretui-pd, 0));
        transition: opacity 180ms ease-out;
      }
      .pretui-magnetic-lean {
        display: inline-flex;
        translate: calc(
            var(--pretui-dx, 0px) * var(--pretui-magnetic-intensity, 0.35)
          )
          calc(var(--pretui-dy, 0px) * var(--pretui-magnetic-intensity, 0.35));
        transition: translate 260ms cubic-bezier(0.22, 1, 0.36, 1);
        will-change: translate;
      }
      /* a finger is already ON the target — never pull the control out
         from under it; the halo still reports the reach */
      .pretui-magnetic[data-pretui-pointer='coarse'] .pretui-magnetic-lean {
        translate: 0 0;
      }
      /* end state under reduced motion: control centred, halo still
         reporting affinity — the information survives, the travel does not */
      @media (prefers-reduced-motion: reduce) {
        .pretui-magnetic-lean {
          translate: 0 0;
          transition: none;
        }
        .pretui-magnetic-halo {
          transition: none;
        }
      }
    </style>
  </template>
}
