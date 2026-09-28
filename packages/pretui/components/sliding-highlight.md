## What it is

The travelling selection indicator: one element that moves and resizes to sit under whichever item is active. **Law 5's second canonical mechanism**, and it is shared — **Tabs**, **SegmentedControl** and **Select** all use this exact component rather than each painting their own active state. Use it whenever a set of peers has one active member and the selection should _travel_ rather than cross-fade. If the active state is a static fill, plain CSS is enough.

## The contract

```
{{slidingHighlight}}          — modifier on the container
<SlidingHighlight />          — the indicator, rendered inside
@variant? 'pill' | 'underline' | 'soft' | 'outline'   (default 'pill')
@duration? (s), @thickness? (px, underline only), @radius? (px)
<:default>   — paint the indicator yourself while keeping the travel
```

**Two parts, and the split is the design.** The modifier measures; the component paints. The modifier publishes `--pretui-highlight-x/y/w/h/on` on the container, and the indicator is an absolutely-positioned element that reads them. So the measuring code exists **once** for the whole kit, and any component that wants a travelling indicator adds a modifier and an element rather than a measurement implementation.

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

The important consequence, and it is a real one: **this component makes selection _look_ well-communicated while contributing nothing to how it is _announced_.** Two of its three consumers have exactly that problem — **SegmentedControl** carries `role="tablist"` over children with no `role="tab"` and no `aria-selected`, and **FilterChips** does the same with `aria-pressed`. In both, the travelling pill is the only clear selection signal, and it is invisible to assistive tech. Fixing those components' roles is the work; this component cannot help.

Other notes:

- **First-paint suppression** exists (the `first` flag), so the indicator does not animate from `0,0` on mount — it appears in place. Without that, every tab strip would slide in from the top-left corner on load.
- **A reduced-motion fallback is described as living in this primitive.** Verify it: the travel is a `transition` on the indicator's position, and `prefers-reduced-motion: reduce` should collapse it to an instant move rather than removing the indicator. This is the right place for that guard and the reason consumers should not roll their own.
- **`--pretui-highlight-on: 0`** hides the indicator when nothing is active, so an empty state does not leave a stray bar.
- The indicator is absolutely positioned inside the container and does not affect layout, so it cannot push content or trap focus.

## Theming

`--pretui-highlight-duration` (default 0.22s), `--pretui-highlight-thickness`, `--pretui-highlight-radius` (defaults to the control radius, or 1px under `underline`), plus the four variants' fills — `pill` is a raised card face, `soft` an accent tint, `outline` a hairline, `underline` a bar.

The published measurement properties (`--pretui-highlight-x/y/w/h/on`) are read-only outputs; a season should not set them.

Because `pill` is a raised card face, it depends on `--card` and the kit's shadow tokens reading distinctly against whatever rail it sits on — a season that makes the rail and the card the same colour leaves a pill visible only by its shadow, which is the most common way this primitive is undermined.
