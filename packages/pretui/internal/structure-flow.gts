// Pretui — STRUCTURE / FLOW. Three components that answer the same question
// from three directions: *when* does a reader get to see this, and how do
// they move through it.
//
//   Wizard        a gated multi-step flow — step model, validity gating,
//                 footer navigation, a labelled panel, and a progress rail
//                 that is StepList, not a second copy of it.
//   Defer         a render gate — hold a subtree until it is worth paying
//                 for (in view / idle / on intent / on a caller flag), with
//                 a placeholder that reserves the final layout's space.
//   EditInPlace   a display value that becomes an editable field on
//                 activation and commits or cancels.
//
// Sourced from the boxel-catalog sweep §3 (Wizard), §8 (Defer) and §6
// (EditInPlace). What each upstream got wrong, and what is done instead, is
// recorded per component below.
//
// Three kit rules govern this file and are worth stating once:
//   * **Compose.** The rail is `StepList`, the placeholder is `Skeleton`,
//     the editor is `Input`, the buttons are `Button`, the delegated
//     listeners are `focus.gts`'s `listen`. Nothing here re-derives a
//     primitive the kit already owns.
//   * **Timers are one-shot and modifier-owned.** `revealsWhenIdle` holds
//     its own handle and clears it in its destructor; nothing re-arms.
//   * **`aria-disabled`, never `disabled`,** anywhere a control must stay
//     focusable so it can explain why it refused.
//
// Every component here lives in its own module under components/; this
// module re-exports them so existing imports keep working.
//
// (the structure-flow group)

// Pretui — focus-on-token modifiers shared by the flow components.
import { modifier } from 'ember-modifier';

// ── focusOnToken ─────────────────────────────────────────────────────────
// `focus.gts`'s `focusWhen` focuses on the render where a boolean BECAME
// true, which is exactly wrong for a surface that must re-take focus on
// every transition: the flag stays true from step 2 to step 3 and the
// modifier never runs again. This one keys on a monotonic token, so each
// increment is a fresh install of the same intent — and token 0 means "the
// first render", which never steals focus (the `autofocus` sin the
// EditInPlace source committed).
//
// Exported as its own primitive per the build contract; both Wizard and
// EditInPlace use it, and any component with a "focus moved because the user
// navigated" transition should.
export const focusOnToken = modifier((el: HTMLElement, [token]: [number]) => {
  if (token > 0) {
    el.focus();
  }
});

const FOCUSABLE_INSIDE =
  'input, textarea, select, button, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * The same token contract, aimed one level in: focuses the first focusable
 * descendant and selects its text when it has any.
 *
 * This is what an inline editor needs. Focusing the WRAPPER — which is what
 * a naive `{{focusWhen}}` on the editor box does — leaves the caret nowhere
 * and the reader typing into the void, and it is the difference between an
 * inline edit that feels native and one that needs a second click.
 */
export const focusInnerOnToken = modifier(
  (el: HTMLElement, [token]: [number]) => {
    if (token <= 0) {
      return;
    }
    let target = el.querySelector<HTMLElement>(FOCUSABLE_INSIDE) ?? el;
    target.focus();
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      target.select();
    }
  },
);
