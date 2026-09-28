// Pretui — Presence: enter and exit transitions for content that appears and disappears.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { cssNumber } from '../pretui-css';
import { presetTransform, seconds } from '../internal/motion-core';
import type { MotionPreset } from '../internal/motion-core';

// ── Presence ─────────────────────────────────────────────────────────────
// Enter AND exit transitions for content that appears and disappears.
//
// Ported from motion-primitives' <AnimatePresence> (itself framer-motion's).
// Upstream needs a whole animation engine for one reason: React removes the
// element the instant the flag flips, so something has to keep a ghost of it
// alive long enough to animate out. That is ~40kB of runtime to defer one
// unmount.
//
// Better than the inspiration: the modern CSS platform now does exit
// transitions natively. `transition-behavior: allow-discrete` lets `display`
// participate in a transition — the browser holds `display: block` for the
// duration and flips to `none` at the end — and `@starting-style` supplies
// the from-values for the enter side, since an element leaving
// `display: none` counts as newly rendered. Zero JS, zero timers, zero
// dependency, and it survives a blocked main thread.
//
// The one API consequence, stated plainly rather than hidden (Law 7): the
// content must stay in the template. Presence owns visibility via @show; do
// NOT wrap it in {{#if}}, or you are back to an instant unmount. Presence
// still works under {{#if}} — you simply get the enter half only.
//
// Dropped upstream surface: `mode='wait' | 'popLayout'` (cross-fading two
// children through a shared layout requires FLIP measurement and a JS
// engine — out of scope for a CSS primitive; render two Presences and stagger
// them with @delay), and variant/keyframe objects (a preset knob plus two
// custom properties covers the honest cases).
export interface PresenceSignature {
  Args: {
    /** visible when true (default). Presence owns display — do NOT also wrap it in {{#if}}, or the exit transition has nothing to animate. */
    show?: boolean;
    /** entrance preset: fade | rise | fall | scale | slide */
    enter?: MotionPreset;
    /** exit preset — separately settable, because leaving reads differently from arriving (Law 7). Defaults to @enter. */
    exit?: MotionPreset;
    /** entrance duration in seconds */
    duration?: number;
    /** exit duration in seconds — defaults to two-thirds of @duration, because leaving should not linger */
    exitDuration?: number;
    /** seconds to wait before entering — the timer-free way to stagger several Presences */
    delay?: number;
    /** travel distance in px for rise / fall / slide */
    distance?: number;
    /** start scale for the scale preset (0–1) */
    scale?: number;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export class Presence extends Component<PresenceSignature> {
  get show(): boolean {
    return this.args.show ?? true;
  }
  // Focus must not be reachable inside content that is on its way out.
  // display:none already removes it once the transition ends; `inert` covers
  // the window in between (upstream leaves that gap open).
  get inert(): true | undefined {
    return this.show ? undefined : true;
  }
  get style(): ReturnType<typeof htmlSafe> {
    let enter = this.args.enter ?? 'fade';
    let exit = this.args.exit ?? enter;
    let duration = this.args.duration !== undefined && this.args.duration > 0
      ? this.args.duration
      : 0.22;
    let bits = [
      `--pretui-presence-enter: ${presetTransform(enter)}`,
      `--pretui-presence-exit: ${presetTransform(exit)}`,
      `--pretui-presence-enter-duration: ${duration.toFixed(3)}s`,
      `--pretui-presence-exit-duration: ${seconds(
        this.args.exitDuration,
        duration * (2 / 3),
      )}`,
      `--pretui-presence-delay: ${(this.args.delay ?? 0).toFixed(3)}s`,
    ];
    {
      let n = cssNumber(this.args.distance, -10000, 10000);
      if (n !== undefined) {
        bits.push(`--pretui-motion-distance: ${n}px`);
      }
    }
    {
      let n = cssNumber(this.args.scale, 0, 100);
      if (n !== undefined) {
        bits.push(`--pretui-motion-scale: ${n}`);
      }
    }
    return htmlSafe(bits.join('; '));
  }
  <template>
    <div
      class='pretui-presence'
      data-show={{if this.show 'true' 'false'}}
      inert={{this.inert}}
      style={{this.style}}
      data-test-pretui-presence
      ...attributes
    >{{yield}}</div>
    <style scoped>
      /* Hidden IS the base rule, so its declarations are also the exit
         destination — and because CSS transitions read the after-change
         style, the exit timing lives here and the enter timing lives on the
         shown rule. One mechanism, two independently tuned halves. */
      .pretui-presence {
        display: none;
        opacity: 0;
        transform: var(--pretui-presence-exit, none);
        transition-property: opacity, transform, display;
        transition-duration: var(--pretui-presence-exit-duration, 150ms);
        transition-timing-function: var(
          --pretui-ease-snap,
          cubic-bezier(0.23, 1, 0.32, 1)
        );
        transition-behavior: allow-discrete;
      }
      .pretui-presence[data-show='true'] {
        display: var(--pretui-presence-display, block);
        opacity: 1;
        transform: none;
        transition-property: opacity, transform, display;
        transition-duration: var(--pretui-presence-enter-duration, 220ms);
        transition-delay: var(--pretui-presence-delay, 0s);
        transition-timing-function: var(
          --pretui-ease-snap,
          cubic-bezier(0.23, 1, 0.32, 1)
        );
        transition-behavior: allow-discrete;
      }
      /* Leaving display:none counts as a first render, so this supplies the
         enter from-state on every appearance, not just the first. */
      @starting-style {
        .pretui-presence[data-show='true'] {
          opacity: 0;
          transform: var(--pretui-presence-enter, none);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-presence,
        .pretui-presence[data-show='true'] {
          transition-property: none;
          transform: none;
        }
      }
    </style>
  </template>
}
