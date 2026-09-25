## What it is

The kit's headless anchored-positioning primitive: render an anchor inline, and while `@open` is true render a fixed-position container placed against it with flip and shift applied. It has no chrome, no dismissal behaviour and no ARIA — it is the thing **Popover**, **Select**, **Lookup**, **Combobox** and **DatePicker** are built out of. Reach for it directly only when you are building a new anchored surface. If you want a floating panel a user opens and closes, use **Popover**; if you want a labelled hint on hover, use **Tooltip**; if you want a blocking surface, use **Dialog**.

## The contract

```
@open?, @placement? (12 values, default 'bottom-start'), @distance? (default 6), @matchWidth? (default false)
<:anchor> <:default>
```

`@placement` is the familiar `side` / `side-start` / `side-end` grid: `top|bottom|left|right` × `(none|-start|-end)`. `@matchWidth` sets the panel's `min-width` to the anchor's measured width — the behaviour a Select menu needs and a Tooltip must not have.

Two decisions worth understanding.

**`position: fixed`, and the panel is inside the anchor wrapper.** Anchored overlays have to escape scroll clipping, so the panel is `position: fixed` with computed `top`/`left`. The kit's lint warns about fixed positioning; it is accepted here for the same reason it is accepted on the Select backdrop. Crucially the panel still lives _inside_ the component's DOM subtree rather than being portalled — which keeps it inside the theme island, so scoped CSS and season tokens apply without a portal-aware provider.

**Positioning is a ~50-line modifier, not a library.** `anchorTo` measures the anchor's `DOMRect` and the panel's real box, flips to the opposite side when the preferred side lacks room and the opposite side has it, then clamps the cross-axis to an 8px viewport gutter. It re-runs on capture-phase `scroll` and on `resize`, and its teardown removes both listeners. Because it only ever runs while `@open` is true, it never executes during prerender — which is the constraint that ruled out the alternatives.

## Prior art

**floating-ui** is the reference implementation and what Radix, Web Awesome (`wa-popup`) and most of the ecosystem use: composable middleware (`offset`, `flip`, `shift`, `arrow`, `size`, `autoPlacement`, `hide`) with `autoUpdate` wiring `ResizeObserver` and ancestor scroll. **`wa-popup`** exposes `placement`, `distance`, `skidding`, `strategy`, `flip`, `shift`, `arrow`, `sync`, `auto-size`. **boxel-ui** uses ember-velcro, which portals to the application root.

Pretui reimplements rather than adopts, for two hard reasons: floating-ui is not realm-importable, and boxel-ui's velcro path portals _outside_ the theme island, which breaks season theming (the `renderInPlace` decision). Given that, the question is what to keep. Kept: offset (`@distance`), flip, shift, and `size`-style width matching. Dropped: `skidding` (cross-axis nudge), arrows, `autoPlacement`, `hide`, and `strategy` selection.

The improvement over a naive reimplementation is that flip measures **the real panel box**, not an estimate — `apply()` reads `getBoundingClientRect()` after the panel is in the DOM, so a panel whose height depends on its content flips correctly on first paint rather than one frame late.

The honest weakness versus floating-ui: no `ResizeObserver` and no `autoUpdate`. If the panel's own content changes size while open — an async list finishing loading — the position is stale until the next scroll or resize event. That is a real bug surface for anything that loads inside a popup.

## Accessibility

**None, by design.** `Popup` emits two `<span>`s and no roles, states or keyboard handling. It is a positioning primitive; the ARIA contract belongs to whatever builds on it. `Popover` adds `role="dialog"` and Escape; `Select` adds `role="listbox"`; `Combobox` adds `aria-activedescendant` and `aria-expanded`.

If you use `Popup` directly you own all of it: labelling, `aria-expanded`/`aria-controls` on the trigger, focus movement, Escape, and dismissal. There is no light-dismiss here either — `Popup` will stay open forever unless you flip `@open`. Consider that a checklist, not a limitation.

One structural note: because the panel is a descendant of the anchor wrapper rather than portalled, it inherits the anchor's stacking and accessibility context. Screen-reader reading order follows DOM order, which is usually what you want and is one place the no-portal choice is straightforwardly better than the ecosystem default.

## Theming

Almost nothing: `z-index: 60` and layout only. Every visual token belongs to the consumer's panel. Seasons that need to re-layer overlays should note the kit's convention — 49/50 for Menu's backdrop and panel, 60 for `Popup` and `Tooltip`, and the native top layer (above everything) for `Dialog` and `Drawer`.
