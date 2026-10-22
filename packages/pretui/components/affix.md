## What it is

**Pin a child to the edge of its scroll container once it scrolls past.** A toolbar that stays at the top of a long form, or a Save bar that stays at the bottom of a long list. The child is usually a **Toolbar**, an **ActionBar** or a **FloatButton**.

Reach for a neighbour when pinning is not the point:

- **PageScaffold**'s `@stickyMasthead` pins the page header.
- **FloatButton** anchors to a corner and does not follow scroll.

## The contract

```
@position? ('top' | 'bottom'; default 'top')
@offset?   — distance from that edge while pinned (default 0)
@onChange? — true when pinned, false when released
<:default as |pinned|>
Element: HTMLDivElement
```

**CSS does the pinning.** The wrapper is `position: sticky` against `@position`, so the browser pins it inside its nearest scroll container, the pane, not the window. There is no scroll listener and no portal.

**An observer tells you whether it is pinned.** CSS can't say whether a sticky element is stuck. So a zero-height sentinel sits just before the child (or just after it, for bottom). An IntersectionObserver rooted at the scroll container watches it, with its edge moved in by the wrapper's actual inset, so the pinned state turns on exactly when an `@offset` wrapper sticks. That state is yielded to the block, set as `data-pinned` on the wrapper for styling, and reported by `@onChange`.

## Prior art

**Ant `Affix`** takes `offsetTop`, `offsetBottom`, `target` (the scroll container) and `onChange`. It measures on scroll and switches the child to `position: fixed`, with a placeholder to hold its space. **Mantine `Affix`** is a fixed-position portal, a different idea. **MUI `useScrollTrigger`** is a hook that reports a threshold crossing.

Where Pretui is better: **sticky, not fixed.** The child keeps its place in the layout, needs no placeholder, and never jumps a frame behind the scroll. **The pinned state comes from an observer**, not a scroll listener.

Where it is thinner: **sticky needs the scroll container to be the nearest ancestor with overflow.** A parent with `overflow: hidden` in between stops it, which is the one case Ant's fixed-plus-placeholder approach handles. There is **no `target` arg**: the scroll container is found by walking up.

## Accessibility

No APG pattern.

- **Pinning is visual, so nothing is announced.** The child keeps its place in the reading and tab order, because sticky doesn't move it in the DOM.
- **The sentinel is `aria-hidden`**, with zero height, so it has no presence.
- **A pinned bar covers content.** A pinned toolbar sits over the top of the scrolled content, so give focusable content `scroll-margin-top` at least the bar's height, or a focused field can hide behind it.

## Theming

`--pretui-affix-offset` (set from `@offset`, default 0), `--pretui-affix-shadow` (applied while pinned, default none) and `--pretui-z-sticky` (the kit's sticky tier, 10).

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                    | Give them                                   |
| ------------------------------ | ------------------------------------------- |
| Ant `<Affix offsetTop={0}>`    | `<Affix>`                                   |
| Ant `offsetBottom`             | `@position='bottom'` + `@offset`            |
| Ant `onChange(affixed)`        | `@onChange`, or the yielded `pinned`        |
| Ant `target={() => container}` | the nearest scroll container, found for you |
| MUI `useScrollTrigger()`       | the yielded `pinned` state                  |
