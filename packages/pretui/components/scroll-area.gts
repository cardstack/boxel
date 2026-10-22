// Pretui — ScrollArea: the Radix / Mantine name and parameters, mapped onto Scroller.
//
//
// **ScrollArea is an alias.** Radix ScrollArea's whole reason to exist is
// JS-rendered scrollbars, and that reason expired: it forces the viewport to
// `overflow: scroll`, injects a `<style>` element to kill the native bars with
// `::-webkit-scrollbar { display: none }` (double scrollbars if CSP blocks it
// and you missed the `nonce` prop), wraps content in a `display: table` div
// that breaks percentage widths, binds a non-passive `wheel` listener on
// `document` per instance, and — measured across all 1189 lines — contains not
// one `aria-*`, `role`, or `tabIndex`, so a scrollable region with no focusable
// children cannot be scrolled by keyboard at all. That is a WCAG 2.1.1 failure
// by construction, and shadcn inherits it while adding a `focus-visible:ring`
// to an element that can never receive focus. Pretui's `Scroller` already
// solves the real problem — it manages the tab stop, adding it when the
// content overflows and REMOVING it when it stops — and `scrollbar-width` /
// `scrollbar-color` are Baseline, so re-implementing a thumb would be strictly
// worse. `ScrollArea` here maps the Radix and Mantine parameter names onto
// Scroller and documents the two knobs Scroller does not yet have.
import Component from '@glimmer/component';
import { Scroller } from './scroller';
import type { ScrollerEdge, ScrollerOrientation } from './scroller';

// ── ScrollArea — ALIAS over Scroller ─────────────────────────────────────
//
// Parameter map:
//
//   Radix / Mantine                     →  Pretui
//   ─────────────────────────────────────────────────────────────────────
//   type='auto' | 'always'              →  @type — native bars stay visible
//   type='hover' | 'scroll'             →  @type — native bars hidden, the
//                                          edge affordance carries the fact
//   scrollbars='x' | 'y' | 'xy'         →  @orientation horizontal|vertical|both
//   dir='rtl'                           →  a `dir` attribute; the CSS is
//                                          logical, so nothing else is needed
//   scrollHideDelay                     →  not applicable — nothing is timed
//   ScrollArea.Autosize                 →  a flex/grid parent with min-size 0
//
// Two Mantine knobs land in Scroller rather than here, and are reported as a
// diff: `scrollbarSize` (a `--pretui-scroller-bar` token) and
// `onScrollPositionChange` / `onBottomReached` (the infinite-scroll seam,
// which Radix has no equivalent for at all — its consumers must ref the
// viewport, and shadcn's composed wrapper makes even that impossible without
// editing the file).

export type ScrollAreaType = 'auto' | 'always' | 'hover' | 'scroll';

export interface ScrollAreaSignature {
  Args: {
    /**
     * Scrollbar policy. `auto` / `always` keep the native scrollbar; `hover` /
     * `scroll` hide it and let the edge affordance carry the fact. Default
     * `auto` — the honest default, since a hidden scrollbar is a removed
     * affordance and Radix's `hover` default is a taste call it never states.
     */
    type?: ScrollAreaType;
    /** Which axes may scroll. Default `vertical` (Radix's implied default). */
    orientation?: ScrollerOrientation;
    /** Accessible name. Supplying one promotes the viewport to a `region`. */
    label?: string;
    /** Edge treatment: `fade` (default), `shadow`, or `none`. */
    edge?: ScrollerEdge;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

/**
 * The Radix/shadcn name for `Scroller`.
 *
 * ```hbs
 * <ScrollArea @label='Activity' @orientation='vertical' @type='hover'>
 *   …
 * </ScrollArea>
 * ```
 *
 * What this alias fixes relative to Radix ScrollArea, by delegating:
 *
 *   • **Keyboard.** Radix's 1189 lines contain no `aria-*`, no `role` and no
 *     `tabIndex`, so a scrollable region with no focusable children cannot be
 *     scrolled by keyboard at all — a WCAG 2.1.1 failure by construction, and
 *     shadcn compounds it by styling a `focus-visible:ring` on an element that
 *     can never take focus. `Scroller` adds the tab stop when the content
 *     overflows and REMOVES it when it stops, which is the part even native
 *     focusable scrollers get right and hand-rolled `tabindex='0'` does not.
 *   • **No injected stylesheet, no `display: table` wrapper, no document-level
 *     non-passive `wheel` listener.** Radix needs all three to hide native
 *     bars and size a JS thumb; `scrollbar-width` is Baseline, so none of it
 *     is needed and none of its failure modes exist here.
 *   • **The affordance survives hiding the bar.** Radix and Mantine hide the
 *     native scrollbar and give you a painted one; `Scroller` hides it and
 *     tells you which edges are clipped, on data attributes, so a flick costs
 *     zero renders.
 */
export class ScrollArea extends Component<ScrollAreaSignature> {
  get type(): ScrollAreaType {
    return this.args.type ?? 'auto';
  }
  get orientation(): ScrollerOrientation {
    return this.args.orientation ?? 'vertical';
  }
  /** `hover` and `scroll` are Radix's "bar appears only during interaction"
   * modes. Without a timer — and without a JS thumb — the honest translation
   * is: hide the native bar and let the edge affordance carry the fact. */
  get hideScrollbar(): boolean {
    return this.type === 'hover' || this.type === 'scroll';
  }
  <template>
    <Scroller
      @label={{@label}}
      @orientation={{this.orientation}}
      @edge={{@edge}}
      @hideScrollbar={{this.hideScrollbar}}
      data-type={{this.type}}
      data-test-pretui-scroll-area
      ...attributes
    >
      {{yield}}
    </Scroller>
  </template>
}
