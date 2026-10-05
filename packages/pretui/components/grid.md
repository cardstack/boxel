## What it is

An auto-filling grid of uniformly sized tiles, where the tile dimensions come from Boxel's **fitted-format** spec table rather than from CSS you write. Use it to lay out a collection of cards at a known format — a search result page, a catalogue, a picker's browse view. If the tiles have varying heights and you want them to pack, use **Masonry**. If the collection is a stream with new items arriving, **Feed**. If it is tabular, **DataGrid**.

## The contract

```
@items: T[]   (required)
@size?: FittedFormatId
@viewFormat? 'grid' | 'list'   (default 'grid')
@fullWidthItem?
<:default as |item, GridItemContainer|>
```

**`@size` is a fitted-format id, not a pixel width.** That is the point of the component: it binds the grid's column width and row height to the same format table the rest of Boxel uses to size a card's fitted render, so a `regular-tile` in a Grid is exactly the size a `regular-tile` is anywhere else. Writing `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))` by hand gets you a grid; using this gets you a grid that *agrees with the platform*.

The second yielded value, `GridItemContainer`, clamps each tile to the format's dimensions. `@fullWidthItem` stretches width while keeping the format's height — the "one wide row per item" arrangement, distinct from `@viewFormat='list'`, which switches the grid to a single column.

**`@items` is required.** boxel-ui's itemless free-content mode is deliberately dropped in this wave — if you want an arbitrary CSS grid, use plain CSS.

The component is a class rather than a `TemplateOnlyComponent` for exactly one reason, documented in the source: a `const … : TemplateOnlyComponent<S>` cannot carry a type parameter, and `T` flowing into the yielded block is worth three extra lines. The rendered DOM is byte-identical.

## Prior art

A **thin runtime wrap of boxel-ui's `GridContainer`**, per the territory rule — the layout engine is boxel-ui's, and the wrapper only remaps the cell gap (`--boxel-sp` ← `--space-4`) so grid rhythm follows the season sheet.

The comparison set is thin because the fitted-format binding has no analogue outside Boxel. **React Spectrum's `CardView`** is the nearest — a virtualised grid with `layout` (`grid`/`waterfall`), selection and drag-and-drop. **shadcn** has no grid component. **Web Awesome** has none.

Where this is better than a hand-rolled `auto-fill` grid: format agreement (above), and the fact that `@viewFormat` switches between grid and list without the call site restructuring its markup.

Where it is behind Spectrum's `CardView`, and the gap is significant at scale: **no virtualisation, no selection, and no drag-and-drop.** Every item renders. For a few dozen tiles that is fine; for a few thousand it is not, and there is no windowing option — you page the data yourself with **Pagination**.

## Accessibility

**No roles, no keyboard handling, and that is the right answer.** A grid of tiles is a *layout*, not a widget. The APG **Grid** pattern (roving tabindex, arrow-key cell navigation, `role="grid"`) exists for tabular data with interactive cells, and applying it to a card grid makes it *harder* to use — arrow keys stop scrolling the page, and every tile becomes unreachable by Tab.

So the accessibility of a Grid is entirely the accessibility of what you yield into it, and that is where to look:

- **Each tile needs its own accessible name.** If tiles are clickable, the clickable element is what carries it — an `<a>` or `<button>` wrapping the tile content, not a `<div>` with a click handler.
- **Do not stack a click handler on the tile and interactive content inside it.** A tile that is itself a link containing a link is invalid and produces unreachable controls. This is the single most common failure in card grids.
- **Reading order follows DOM order**, which follows `@items` order, so WCAG **1.3.2 Meaningful Sequence** and **2.4.3 Focus Order** hold by construction — `auto-fill` reflows visually without reordering the DOM.
- **The container has no accessible name or list semantics.** A screen-reader user is not told "24 items"; they encounter a run of tiles. Wrapping in a `<ul>`/`<li>` or `role="list"` at the call site is worth doing for anything countable.
- **Reflow (WCAG 1.4.10)**: `auto-fill` handles narrow viewports correctly, but the *tile* width comes from the fitted-format table and is fixed — so at 320px a wide format will overflow rather than shrink. Choose the format for the narrowest context.
- **No virtualisation** means no `aria-setsize`/`aria-posinset` bookkeeping is needed, which is one genuine upside of rendering everything.

## Theming

Consumed: `--foreground`, `--text-ui-md`, `--track-ui`.

Remapped into the boxel-ui channel: `--boxel-sp` ← `--space-4` (the cell gap).

That is the entire surface — the Grid paints no background, no border and no shadow, and inherits whatever it sits on. All visual weight belongs to the tiles you yield. Column width and row height come from the fitted-format table and are **not** tokenised, so a season cannot retune tile dimensions; changing them means changing `@size`.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
