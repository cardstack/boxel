## What it is

**ScrollArea is the Radix and Mantine name and parameters, mapped onto Scroller.** It is not a second scroll container. Radix ScrollArea exists to render scrollbars in JavaScript, and that reason has expired: `scrollbar-width` and `scrollbar-color` are Baseline. **Scroller** already solves the real problem. It manages the tab stop, adding it when the content overflows and removing it when it doesn't, and it reports which edges are clipped. So ScrollArea translates the vocabulary an agent types into Scroller's args.

Use **Scroller** directly in new code. Use ScrollArea when a port already says ScrollArea, or when you want the Radix `type` values.

## The contract

```
@type? ('auto' | 'always' | 'hover' | 'scroll')
@orientation? ('vertical' | 'horizontal' | 'both'; default 'vertical')
@label?   — names the region, and only a named region is a landmark
@edge?    — Scroller's edge treatment: 'fade' | 'shadow' | 'none'
<:default>
Element: HTMLDivElement
```

**The `type` vocabulary.** `auto` and `always` keep the native scrollbars visible. `hover` and `scroll` hide them and let the edge affordance carry the "there is more" fact.

**The rest of the Radix and Mantine parameters.**

- `scrollbars='x' | 'y' | 'xy'` is `@orientation`.
- `dir='rtl'` is a `dir` attribute. The CSS is logical, so nothing else is needed.
- `scrollHideDelay` doesn't apply, because nothing is timed.
- `ScrollArea.Autosize` is a flex or grid parent with `min-size: 0`.
- Mantine's `scrollbarSize` is Scroller's `--pretui-scroller-bar` token.

`@orientation` defaults to vertical, which is what Radix implies.

## Prior art

**Radix `ScrollArea`** (and shadcn's wrapper) has Root, Viewport, Scrollbar, Thumb and Corner. It forces `overflow: scroll`, injects a `<style>` element to hide the native bars (so CSP without a `nonce` gives double scrollbars), wraps the content in a `display: table` div that breaks percentage widths, and binds a non-passive `wheel` listener per instance. Across 1,189 lines it has no `aria-*`, `role` or `tabIndex`, so a region with no focusable children cannot be scrolled by keyboard at all. **Mantine `ScrollArea`** adds `scrollbarSize`, `offsetScrollbars` and `onScrollPositionChange`.

Where Pretui is better: **keyboard scrolling works**, because Scroller adds a tab stop exactly when the content overflows. That fixes a WCAG 2.1.1 failure Radix and shadcn ship by construction. **Native scrollbars** mean no injected styles and no `display: table` wrapper.

Where it is thinner: **no painted thumb.** The native scrollbar is styled with tokens, not replaced. There is **no scroll-position callback** yet, the seam Mantine's `onScrollPositionChange` and `onBottomReached` fill, and **no `offsetScrollbars`**.

## Accessibility

Identical to Scroller.

- **Keyboard reachable exactly when it scrolls.** The viewport gets `tabindex="0"` while its content overflows, and loses it when it doesn't.
- **Named means a landmark.** With `@label` the viewport is a `role="region"` with that name. Unnamed, it gets no role, because an unnamed region is noise in a screen reader's landmark list. The tests assert both.
- **The edge fade is decoration.** The fact that more content exists is also carried by the scrollbar and the tab stop.

## Theming

`--pretui-scroller-bar` (the native scrollbar size, Mantine's `scrollbarSize`), plus everything **Scroller** reads for its edges and scrollbar colours.

## React ecosystem

| Radix / Mantine                         | Pretui                                |
| --------------------------------------- | ------------------------------------- |
| `<ScrollArea type="hover">`             | `<ScrollArea @type='hover'>`          |
| `scrollbars="x"` / `"y"` / `"xy"`       | `@orientation`                        |
| `<ScrollArea.Viewport>` + `<Scrollbar>` | nothing: one element, native bars     |
| Mantine `scrollbarSize`                 | `--pretui-scroller-bar`               |
| Mantine `onScrollPositionChange`        | not yet: listen on the viewport       |
| `ScrollArea.Autosize`                   | a flex/grid parent with `min-size: 0` |
