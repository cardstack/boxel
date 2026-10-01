// Pretui — PulsingBorder: a border that pulses or trails to draw attention to a surface.
import Component from '@glimmer/component';
import { Chip } from './chip';
import { statusHue } from '../internal/ink';
import { clampNum, cssValue, styleFrom } from '../internal/texture';

// ── PulsingBorder ────────────────────────────────────────────────────────

/** `pulse` = breathing halo; `trail` = a light travelling the ring. */
export type PulsingBorderVariant = 'pulse' | 'trail';

/** Where the text affordance sits on the boundary. */
export type PulsingBorderMarker =
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end';

export interface PulsingBorderSignature {
  Args: {
    /** The text affordance — what the pulse MEANS ("Live", "Streaming", "Recording"). Law 6: a pulsing border alone is invisible to a screen reader and unindexable, so this always renders (visibly, or sr-only when `@marker={{false}}`). */
    label?: string;
    /** Is it actually live? False rests the ring on the neutral border color and stops all motion — the label should change with it. */
    active?: boolean;
    /** `pulse` (breathing halo) or `trail` (a light travelling the ring). */
    variant?: PulsingBorderVariant;
    /** Ring hue. Defaults to `statusHue(label)` — Law 2: the same word gets the same hue on every card. */
    hue?: string;
    /** Motion rate multiplier (1 = natural). */
    speed?: number;
    /** Ring thickness in px. Default 1.5. */
    thickness?: number;
    /** Render the affordance visibly on the boundary. False keeps it sr-only — for when the surrounding UI already carries the words. It never disappears entirely. */
    marker?: boolean;
    /** Corner of the boundary the affordance sits on. */
    markerPlacement?: PulsingBorderMarker;
  };
  Blocks: {
    /** The bounded content. */
    default: [];
    /** Replaces the affordance text with your own markup (Law 7: anything visual a caller might replace is a slot). */
    label: [];
  };
  Element: HTMLDivElement;
}

/**
 * The "this is live" boundary treatment — and the canonical Law 6 borderline
 * case. A pulsing border on its own is information carried entirely by
 * texture: invisible to a screen reader, unindexable, and gone from a still
 * frame. So the affordance is not optional here. The component renders a
 * `role='status'` marker (an ink `Chip`, reused rather than re-drawn) on the
 * boundary itself; `@marker={{false}}` demotes it to sr-only text but never
 * removes it.
 *
 * Ported in behavior from react-bits' ElectricBorder / StarBorder and
 * motion-primitives' BorderTrail. Dropped: their canvas/WebGL electric
 * distortion (Law 9), and their assumption that a border can say "live"
 * unaccompanied. Improved: the ring is an inset `box-shadow` rather than a
 * `border`, so turning it on never reflows the content (Law 1 — depth is one
 * property); the halo animates `transform`/`opacity` only; and the resting
 * state is a visible hairline + soft glow, so it survives the screenshot
 * test (Law 8) and reduced motion identically.
 */
export class PulsingBorder extends Component<PulsingBorderSignature> {
  get label(): string {
    return this.args.label ?? 'Live';
  }
  get active(): boolean {
    return this.args.active ?? true;
  }
  get variant(): PulsingBorderVariant {
    return this.args.variant === 'trail' ? 'trail' : 'pulse';
  }
  get isTrail(): boolean {
    return this.variant === 'trail';
  }
  get showMarker(): boolean {
    return this.args.marker ?? true;
  }
  get markerPlacement(): PulsingBorderMarker {
    return this.args.markerPlacement ?? 'top-start';
  }
  // Law 2: one hue in, a complete treatment out — and when the caller does
  // not name one, derive it from the value so "Live" is the same hue on
  // every card by every author.
  get hue(): string {
    return cssValue(this.args.hue) ?? statusHue(this.label);
  }
  get chipHue(): string {
    return this.active ? this.hue : 'var(--muted-foreground)';
  }
  get style() {
    let parts: string[] = [`--pretui-pb-hue: ${this.hue}`];
    let speed = clampNum(this.args.speed, 0.05, 6);
    if (speed !== undefined) parts.push(`--pretui-pb-speed: ${speed}`);
    let thickness = clampNum(this.args.thickness, 0.5, 8);
    if (thickness !== undefined) {
      parts.push(`--pretui-pb-thickness: ${thickness}px`);
    }
    return styleFrom(parts);
  }
  <template>
    <div
      class='pretui-pb'
      data-variant={{this.variant}}
      data-active={{if this.active 'true' 'false'}}
      data-marker={{this.markerPlacement}}
      style={{this.style}}
      data-test-pretui-pulsing-border
      ...attributes
    >
      <span class='pretui-pb-ring' aria-hidden='true'></span>
      {{#if this.isTrail}}
        <span class='pretui-pb-trail' aria-hidden='true'></span>
      {{else}}
        <span class='pretui-pb-halo' aria-hidden='true'></span>
      {{/if}}

      {{#if this.showMarker}}
        <span
          class='pretui-pb-marker'
          role='status'
          data-test-pretui-pulsing-border-marker
        >
          <Chip @hue={{this.chipHue}}>
            {{#if (has-block 'label')}}{{yield to='label'}}{{else}}{{this.label}}{{/if}}
          </Chip>
        </span>
      {{else}}
        <span
          class='pretui-pb-sr'
          role='status'
          data-test-pretui-pulsing-border-marker
        >{{#if (has-block 'label')}}{{yield to='label'}}{{else}}{{this.label}}{{/if}}</span>
      {{/if}}

      <div class='pretui-pb-body'>{{yield}}</div>
    </div>
    <style scoped>
      .pretui-pb {
        position: relative;
        border-radius: var(--pretui-pb-radius, var(--radius-surface, 10px));
        isolation: isolate;
      }
      /* Law 1: the boundary is a shadow, not a border — switching it on can
         never reflow the content it wraps. */
      .pretui-pb-ring {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        z-index: 2;
        box-shadow: inset 0 0 0 var(--pretui-pb-thickness, 1.5px)
          color-mix(
            in oklch,
            var(--pretui-pb-hue, var(--primary)) 72%,
            transparent
          );
      }
      .pretui-pb[data-active='false'] .pretui-pb-ring {
        box-shadow: inset 0 0 0 var(--pretui-pb-thickness, 1.5px)
          var(--border);
      }
      /* resting state = a soft static glow (screenshot test); the keyframes
         only add the breathing on top of it */
      .pretui-pb-halo {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        z-index: 0;
        opacity: 0.42;
        box-shadow: 0 0 0 3px
          color-mix(
            in oklch,
            var(--pretui-pb-hue, var(--primary)) 30%,
            transparent
          );
      }
      @keyframes pretui-pb-breathe {
        from {
          opacity: 0.42;
          transform: scale(1);
        }
        to {
          opacity: 0;
          transform: scale(1.028);
        }
      }
      .pretui-pb[data-active='true'] .pretui-pb-halo {
        animation: pretui-pb-breathe calc(2.6s / var(--pretui-pb-speed, 1))
          cubic-bezier(0.23, 1, 0.32, 1) infinite;
      }
      .pretui-pb[data-active='false'] .pretui-pb-halo {
        opacity: 0;
      }

      /* trail: a conic sweep clipped to the ring band by a two-layer mask.
         The angle is a registered custom property so the sweep is one
         declaration; if @property is unavailable the fallback angle still
         resolves and the ring rests as a static gradient boundary. */
      @property --pretui-pb-angle {
        syntax: '<angle>';
        inherits: false;
        initial-value: 0deg;
      }
      .pretui-pb-trail {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        z-index: 1;
        padding: calc(var(--pretui-pb-thickness, 1.5px) + 1px);
        background: conic-gradient(
          from var(--pretui-pb-angle, 0deg),
          transparent 0turn 0.55turn,
          color-mix(
              in oklch,
              var(--pretui-pb-hue, var(--primary)) 45%,
              transparent
            )
            0.82turn,
          var(--pretui-pb-hue, var(--primary)) 0.94turn,
          transparent 1turn
        );
        mask-image: linear-gradient(rgb(0 0 0 / 1) 0 0),
          linear-gradient(rgb(0 0 0 / 1) 0 0);
        mask-clip: content-box, border-box;
        mask-composite: exclude;
      }
      @keyframes pretui-pb-sweep {
        to {
          --pretui-pb-angle: 360deg;
        }
      }
      .pretui-pb[data-active='true'] .pretui-pb-trail {
        animation: pretui-pb-sweep calc(4.5s / var(--pretui-pb-speed, 1))
          linear infinite;
      }
      .pretui-pb[data-active='false'] .pretui-pb-trail {
        opacity: 0.3;
      }

      .pretui-pb-marker {
        position: absolute;
        z-index: 3;
        display: inline-flex;
        line-height: 0;
      }
      .pretui-pb[data-marker='top-start'] .pretui-pb-marker {
        top: 0;
        left: var(--space-4, 11px);
        transform: translateY(-50%);
      }
      .pretui-pb[data-marker='top-end'] .pretui-pb-marker {
        top: 0;
        right: var(--space-4, 11px);
        transform: translateY(-50%);
      }
      .pretui-pb[data-marker='bottom-start'] .pretui-pb-marker {
        bottom: 0;
        left: var(--space-4, 11px);
        transform: translateY(50%);
      }
      .pretui-pb[data-marker='bottom-end'] .pretui-pb-marker {
        bottom: 0;
        right: var(--space-4, 11px);
        transform: translateY(50%);
      }
      .pretui-pb-body {
        position: relative;
        z-index: 1;
        border-radius: inherit;
      }
      .pretui-pb-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-pb-halo,
        .pretui-pb-trail {
          animation: none;
        }
      }
    </style>
  </template>
}
