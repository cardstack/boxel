## What it is

A staggered multi-column wall of items of varying heights — a moodboard, a gallery, tasting notes, a wall of quotes. Use it when the items are **peers** and their order does not rank them. If order matters and "first" must read top-left then rightwards, use **Grid**, which is row-major. If items stream in over time, **Feed**.

## The contract

```
@items: readonly T[]   (required)
@columns? (default 3), @min? (default '16rem'), @gap? (default 14)
<:item as |item, index|>
```

`@columns` is a *maximum*; the browser uses fewer when `@min` will not fit. `@gap` is also settable as `--pretui-masonry-gap`.

**The reading-order trap, stated up front rather than discovered later.** This is native CSS multi-column, so:

- **DOM order, keyboard order and screen-reader order are the order you pass `@items`.** Always. That is the accessible order and it never moves.
- **The visual order is column-major.** Item 1 is top-left and item 2 is *below* it, not to its right; a column fills to the bottom before the next begins.

So Masonry is right for a wall of peers and **wrong for ranked content**. When the container is narrower than two `@min` columns it collapses to one column, where column-major and row-major are the same thing.

## Prior art

**react-masonry-css** and the JS masonry engines (Masonry.js, MUI's `Masonry`) all do the same thing: measure every child, compute placements, and re-lay-out on resize. That buys row-major fill — items read left-to-right in visual order — at two prices: measurement jank on every resize, and **a DOM whose order no longer matches what anyone sees**.

Pretui refuses that trade, and the refusal is the design: **zero measurement, zero JS, and the reading order is stated out loud instead of being a surprise.** The component is a `column-count` container and a `{{#each}}`.

That is genuinely better for accessibility and performance, and genuinely worse for one thing: you cannot have row-major fill. The honest framing is that this is a *different* component from a JS masonry, not a cheaper one, and choosing it means accepting column-major reading. **Grid** is the row-major option.

Also dropped from the JS originals: animated reflow on resize, and infinite-scroll integration (that is **Feed**'s job).

One implementation note worth flagging as a weakness: `{{#each @items key='@index'}}`. Keying by index rather than by a stable id means a reordered or filtered list rebuilds every cell's DOM. For a static moodboard that is fine; for a filterable gallery it discards image decode state and any in-cell interaction. **DataGrid** has the same issue and it is worth fixing in both.

## Accessibility

No pattern governs it; this is layout, and the relevant criteria are WCAG **1.3.2 Meaningful Sequence**, **2.4.3 Focus Order** and **1.4.10 Reflow**.

The central fact is the one above, and it cuts both ways:

- **1.3.2 and 2.4.3 are satisfied by construction.** DOM order is the source order, and nothing reorders it — no `order`, no `grid-row`, no absolute placement. A JS masonry that achieves row-major *visual* order while leaving DOM order untouched creates exactly the mismatch these criteria prohibit; this component cannot.
- **But visual and reading order still differ**, because column-major reading is not how most sighted users scan a wall. That is not a WCAG failure — the criteria are about *programmatic* sequence — but it does mean a sighted user and a screen-reader user encounter the items in different sequences. For peers that is harmless. For anything ranked it is misleading, which is why the component says so.

Other gaps:

- **The container has no list semantics and no accessible name.** No `role="list"`, no `aria-label`, no count. A screen-reader user encounters a run of cells with no indication that they belong together or how many there are. Wrapping in a labelled `role="list"` at the call site is worth doing.
- **Cells are plain `<div>`s.** Everything about a cell's accessibility — its name, whether it is interactive, whether it is a single click target — belongs to `<:item>`. The usual card-grid failure applies: do not put a click handler on the cell *and* interactive content inside it.
- **A cell never splits across columns**: every cell sets `break-inside: avoid`.
- **Reflow**: `@min` governs when columns drop, and collapsing to one column at narrow widths satisfies **1.4.10** cleanly.
- Nothing is focusable at the container level, correctly.

## Theming

`--pretui-masonry-columns`, `--pretui-masonry-min` and `--pretui-masonry-gap` — all three settable as tokens *or* as args (the args write the tokens inline). That is the cleanest theming surface in the structure territory: a season can set a house masonry rhythm without any call site changing.

The component paints nothing else — no background, no border, no cell chrome. All visual weight belongs to what you yield.

Note the arg-writes-token pattern means a call-site `@gap` beats an ancestor's `--pretui-masonry-gap`, since inline styles win. A season setting the token gets the default for every Masonry that does not override it, which is the intended layering.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
