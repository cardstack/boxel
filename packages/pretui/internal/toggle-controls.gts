// Pretui — the toggle territory: three components whose whole difficulty is
// that the obvious implementation is inaccessible.
//
//  * `ToggleGroup`  — one set of related toggles, single- or multi-select.
//  * `ToggleMatrix` — the same idea in two dimensions: permissions grids,
//                     availability rotas, feature-by-plan tables.
//  * `HoverActions` — the action cluster that appears over a row or a tile.
//
// Sourced from the boxel-catalog sweep (§4, §5, §9). Each component names,
// at its own definition, what the upstream got wrong and what was fixed.
//
// Two decisions are shared by all three and are worth stating once.
//
// **1. Roving tabindex is the accessibility feature, not the flourish.** A
// weekday picker with seven tab stops, a 7×24 rota with 168 of them, and a
// fifty-row list whose every row holds four hover buttons are all the same
// defect: the keyboard cost of the control scales with its data. Every
// composite here is ONE tab stop with arrows inside, built on `focus.gts`'s
// `rovingTabindex` / `focusWhen` / `listen` — the kit's shared foundation, so
// there is no fourth private copy of this logic.
//
// **2. State never travels by colour alone** (Law 6). A
// pressed ToggleGroup item swaps its whole appearance recipe (solid face vs.
// hairline), a live matrix cell carries a drawn check, and the matrix's
// current column is marked with `aria-current` and a caret rather than a tint.
// All three survive the greyscale screenshot test.
//
// Pretui — primitives shared by ToggleGroup, ToggleMatrix and HoverActions.
import { modifier } from 'ember-modifier';

// ─────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sets a checkbox's `indeterminate` state.
 *
 * `indeterminate` is an IDL property with **no matching content attribute**,
 * so there is no markup that expresses it — `indeterminate='true'` is inert
 * HTML, and Glimmer's property-binding path for a dynamic attribute is not a
 * contract worth betting a tri-state control on. A modifier writes the
 * property, which is the only thing that has ever worked.
 *
 * This belongs in `focus.gts` beside `rovingTabindex` (same shape, same
 * reason: a lint rule or the platform forbids the attribute form). It is
 * exported here so a mixed-state checkbox anywhere in the kit has one
 * implementation; the move is offered as a diff rather than made unilaterally.
 */
export const indeterminateWhen = modifier(
  (el: HTMLElement, [mixed]: [boolean]) => {
    (el as HTMLInputElement).indeterminate = mixed;
  },
);

/** How much of a row / column / matrix is switched on. */
export type BulkState = 'none' | 'some' | 'all';

/** `none` when nothing is on, `all` when everything is, `some` between. An
 * empty span is `none`, never `all` — "select all of nothing" must not render
 * as a satisfied checkbox. */
export function bulkStateOf(live: number, total: number): BulkState {
  if (total <= 0 || live <= 0) {
    return 'none';
  }
  return live >= total ? 'all' : 'some';
}

/** The inclusive, ordered span between two indices — the arithmetic behind
 * shift-to-extend in both axes. Pure so it is testable without a DOM. */
export function spanBetween(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/** Clamps `next` into `[low, high]`, returning `low` when the range is
 * inverted (no navigable cells) rather than producing a phantom index. */
export function clampIndex(next: number, low: number, high: number): number {
  if (high < low) {
    return low;
  }
  return Math.min(high, Math.max(low, next));
}
