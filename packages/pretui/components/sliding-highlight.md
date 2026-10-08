## What it is

The traveling selection indicator: one element that moves and resizes to sit under whichever item is active. **Law 5's second canonical mechanism**, and it is shared — **Tabs** and **SegmentedControl** both use this exact component rather than each painting their own active state. Use it whenever a set of peers has one active member and the selection should _travel_ rather than cross-fade. If the active state is a static fill, plain CSS is enough.

## The contract

```
{{slidingHighlight}}          — modifier on the container
<SlidingHighlight />          — the indicator, rendered inside
@variant? 'pill' | 'underline' | 'soft' | 'outline'   (default 'pill')
@duration? (s), @thickness? (px, underline only), @radius? (px)
<:default>   — paint the indicator yourself while keeping the travel
```

**Two parts, and the split is the design.** The modifier measures; the component paints. The modifier publishes `--pretui-highlight-x/y/w/h/on` on the container, and the indicator is an absolutely-positioned element that reads them. So the measuring code exists **once** for the whole kit, and any component that wants a traveling indicator adds a modifier and an element rather than a measurement implementation.

**It needs no arguments to work.** The default selector finds the active descendant; pass a custom one (`':scope > [aria-selected="true"]'`) when the container also holds selectable content the default would reach.

**The modifier claims a containing block if the container has not.** If the container computes to `position: static` it sets `position: relative` — so a caller cannot forget the one CSS prerequisite.

`--pretui-highlight-on` goes to `0` when there is no active item, so the indicator disappears rather than parking at the last position.

The block slot exists for callers who want to paint the indicator themselves — a gradient, a texture — while keeping the travel.

## Prior art

Every kit paints this differently, and almost all of them cross-fade. **Radix `Tabs`** leaves the indicator to CSS on the active trigger. **Web Awesome `wa-tab-group`** does the same. **shadcn** styles the active tab's background. In all three, getting an indicator that _travels_ means writing measurement code yourself, per component.

The nearest real prior art is **Framer's `layoutId`** (shared-layout animation), which achieves the travel through FLIP measurement in a JS animation engine on every frame.

Pretui's improvement is structural rather than visual: **one measured implementation, adopted rather than copied.** The source records the reasoning when **SegmentedControl** took it up — adopting the shared primitive rather than keeping a local copy means the measuring code, the first-paint suppression and the reduced-motion fallback live in exactly one place. And the modifier reads the same `data-state='active'` the styling already used, so no component had to hand over its DOM or thread an active index through.

The measurement is a `ResizeObserver` plus offset reads, not a RAF loop — so it costs nothing between changes, unlike the Framer approach.

Where a second copy still exists: **TableOfContents** has a local vertical implementation of the same idea, with a note that it should be replaced by this component once both are on the realm. Two implementations of a "one implementation" primitive is worth closing.

## Accessibility

**No roles, no states, no keyboard — and that is correct.** The indicator is decoration; the selection it tracks is expressed by whatever the container marks as active (`aria-selected` on a tab, `aria-checked` on a radio, `data-state` on a segment).

The important consequence, and it is a real one: **this component makes selection _look_ well-communicated while contributing nothing to how it is _announced_.** Each consumer exposes the selection itself: **Tabs** with `aria-selected`, **SegmentedControl** with native checked radios. A new consumer must do the same; the pill alone is invisible to assistive tech.

Other notes:

- **First-paint suppression** exists (the `first` flag), so the indicator does not animate from `0,0` on mount — it appears in place. Without that, every tab strip would slide in from the top-left corner on load.
- **Reduced motion** sets `transition-property: none`, so the indicator moves to its new place instantly instead of disappearing. The guard lives here so consumers don't roll their own.
- **`--pretui-highlight-on: 0`** hides the indicator when nothing is active, so an empty state does not leave a stray bar.
- The indicator is absolutely positioned inside the container and does not affect layout, so it cannot push content or trap focus.

## Theming

`--pretui-highlight-duration` (default 0.18s), `--pretui-highlight-ease` (default `cubic-bezier(0.23, 1, 0.32, 1)`), `--pretui-highlight-thickness`, `--pretui-highlight-radius` (defaults to the control radius, or 1px under `underline`), plus the four variants: `pill` is a `--card` face with a 1px `--border-strong` edge and `--shadow-sm`, `soft` a `--primary` tint over `--card`, `outline` a 1px `--primary-ink` line, `underline` a `--primary-ink` bar. Lines use the `-ink` because the `--primary` fill misses 3:1 as a line.

The published measurement properties (`--pretui-highlight-x/y/w/h/on`) are read-only outputs; a theme or caller should not set them.

Because `pill` is a card face, it depends on `--card`, its `--border-strong` edge and `--shadow-sm` reading distinctly against whatever rail it sits on. A theme that makes the rail and the card the same color leaves the pill visible only by its edge and shadow.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
