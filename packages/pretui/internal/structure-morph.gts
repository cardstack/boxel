// Pretui — structure/morph: surfaces whose motion IS the state change.
//
//   AnimatedImage    animated GIF/WEBP with a real pause control
//   DynamicIsland    a status capsule that morphs between three views
//   MorphingDialog   a card that grows into its own modal dialog
//   MorphingPopover  a trigger that grows into its own anchored panel
//
// ── Law 5 is the entrance exam for this whole file ───────────────────────
//
// "Motion is allowed where it encodes a state transition the reader would
// otherwise have to infer; forbidden where it merely decorates." Every
// animation here is the visible form of a state change and nothing here
// animates at rest:
//
//   AnimatedImage    the motion IS the content; the component's own job is
//                    to make it STOPPABLE (WCAG 2.2.2) and to start stopped
//                    when the reader asked for less motion.
//   DynamicIsland    idle → compact → expanded. The capsule growing is what
//                    tells you the same object gained detail rather than a
//                    second object appearing.
//   Morphing*        this surface came FROM that trigger. Without the morph
//                    the reader has to work out which of six cards opened.
//
// And every one of them lands on the END STATE under
// `prefers-reduced-motion: reduce` — the dialog is simply open, the island
// is simply expanded, the image is simply paused. Never a frozen midpoint.
//
// ── Reuse, not a second Dialog ───────────────────────────────────────────
//
// `MorphingDialog` wraps `Dialog` from overlay.gts and `MorphingPopover`
// wraps `Popup`. The focus trap, Escape, the top layer, `::backdrop` and
// focus RETURN all come from the native `<dialog>` element that `Dialog`
// already drives correctly; the anchored placement, flip and shift come from
// `anchorTo`. Nothing about either of those was re-implemented — the only
// thing added is the morph, and it is added through ONE shared primitive
// (`morphFrom`) rather than twice.
//
// Pretui — shared motion helpers for the morphing components (morphFrom and friends).
import { cancel, scheduleOnce } from '@ember/runloop';
import { modifier } from 'ember-modifier';

// ── Shared ───────────────────────────────────────────────────────────────

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * THE morph primitive, and the reusable artifact of this file.
 *
 * Given the rectangle a surface came FROM, it animates the surface from that
 * rectangle's position and size to its own. This is a FLIP: the surface is
 * already laid out at its final geometry when the animation starts, so the
 * end state is the truth and the start state is the inversion of it. Nothing
 * is measured twice and no layout is faked.
 *
 * Three deliberate mechanism choices, each of which is the reason the
 * alternative was rejected:
 *
 *  * **`element.animate()` (WAAPI), not a CSS transition.** The exact
 *    translate/scale pair is only knowable at open time, and it must
 *    OUTRANK the transition the wrapped component already declares on the
 *    same element. A web animation wins that by cascade rank, so no
 *    specificity game — no doubled class, no `!important` — is needed to
 *    take over an element another component styles.
 *  * **`@starting-style` was not enough.** It cannot read a geometry that
 *    is only known once both boxes exist, and the wrapped `Dialog` already
 *    owns a `@starting-style` rule on the same element.
 *  * **`scheduleOnce('afterRender')`, not `requestAnimationFrame`.** The
 *    measurement cannot happen in the modifier body: a modal `<dialog>` is
 *    `display: none` until the component's own modifier calls `showModal()`,
 *    and modifier ordering between a wrapper and the component it wraps is
 *    not something to bet an animation on. The `afterRender` queue runs once
 *    every modifier in the transaction has, so the element is always laid
 *    out by then — and unlike a rAF it is INSIDE the runloop, so
 *    `await settled()` waits for it and a test can never race it. The token
 *    is cancelled in the destructor.
 *
 * Passing `undefined` (or running under reduced motion) does nothing at all,
 * which is how the reduced-motion path lands on the end state: the surface
 * is simply there.
 */
export const morphFrom = modifier(
  (element: HTMLElement, [origin]: [DOMRect | undefined]) => {
    if (!origin || prefersReducedMotion()) {
      return;
    }
    let animation: Animation | undefined;
    // Hoisted rather than inlined: `scheduleOnce` dedupes on the identity of
    // (target, method), and an inline function expression is a fresh
    // identity every call — which is why the lint rule rejects one.
    let start = () => {
      // Forces layout, which is what makes the measurement true even on the
      // frame the dialog was promoted to the top layer.
      let rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        return;
      }
      let sx = clamp(origin.width / rect.width, 0.04, 1);
      let sy = clamp(origin.height / rect.height, 0.04, 1);
      let dx = origin.left + origin.width / 2 - (rect.left + rect.width / 2);
      let dy = origin.top + origin.height / 2 - (rect.top + rect.height / 2);
      animation = element.animate(
        [
          {
            transform:
              'translate(' +
              dx.toFixed(1) +
              'px, ' +
              dy.toFixed(1) +
              'px) scale(' +
              sx.toFixed(4) +
              ', ' +
              sy.toFixed(4) +
              ')',
            opacity: 0.2,
          },
          // The content is legible well before the box stops moving, which
          // is what stops a non-uniform scale from reading as a squash.
          { opacity: 1, offset: 0.4 },
          { transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1 },
        ],
        { duration: 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      );
    };
    let scheduled = scheduleOnce('afterRender', element, start);
    return () => {
      cancel(scheduled);
      animation?.cancel();
    };
  },
);
