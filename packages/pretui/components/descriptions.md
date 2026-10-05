## What it is

A read-only record as label/value pairs in an N-column grid that folds to stacked: the thing an agent types after Ant's `Descriptions`. N pairs per row, a per-item `span`, an optional title with a trailing `<:extra>` slot, borders that tint the label cells, and a container query that reduces the column count as the pane narrows.

It is not **RecordDetail**, which is the editing machine: a draft batch, one open editor, dirty counts, save and cancel. It is not **KeyValue** either, though that is the nearest thing: **KeyValue** is a fixed two-column `<dl>` with no borders, no header, no spans, no density and no fold, and six facts beside a card still want it. Descriptions is the page-scale form of the same idea. **PropertyRow** is one labelled value in a form; **Field** is the form control's frame.

## The contract

```
@items                      — { label, value?, span?, key?, mono? }[] in reading order
@columns? | @column?        — pairs per row at full width, 1–4 (default 3; Ant's spelling accepted)
@bordered?                  — rule the grid and tint the label cells
@layout?                    — 'horizontal' (default) | 'vertical'
@size?                      — xs|s|m|l|xl; sm/md/lg accepted
@title?                     — header text; the <:title> block wins
@colon?                     — trailing colon after every label (default false)
@labelWidth?                — any CSS length for the label column in horizontal layout
@placeholder?               — printed for an item with no value and no block (default '—')
<:value as |item index|>    — markup for a description; wins over item.value
<:title> <:extra>           — the header, and its trailing slot
```

**The column count is requested on the root and resolved on the grid.** `@columns` sets `--pretui-desc-cols-req` on the component root; the grid reads it into `--pretui-desc-cols`, and the container queries override that inner property at 44rem (3 and 4 become 2) and 26rem (everything becomes 1). Asking for 4 in a pane that fits 2 resolves to 2 with no JavaScript, and a request for 1 or 2 is never raised: the queries only ever reduce the count.

**`span` is clamped the same way.** A number is clamped to 1–4 and to the row when the grid folds; `'fill'` takes the rest of the row at every width.

**The `<:value>` block wins over `value`.** It is rendered for every item, with the item and its index, so markup never has to be smuggled through a string. An item with neither prints `@placeholder`, never the string "undefined".

**`@labelWidth` goes through the kit's CSS-value guard**, so a caller string cannot inject a second declaration.

## Prior art

**Ant `Descriptions`** takes `column` (a number or a breakpoint map), `layout`, `bordered`, `colon` (default true), `size`, `title`, `extra` and `items` with per-item `span`. **Mantine `DataList`** and **Chakra `DataList`** are the same shape with `orientation` in place of `layout`. **shadcn** has no equivalent; the recipe is a `<dl>` with grid classes.

Where this is better: **it is a `<dl>` in every mode.** Ant emits a `<table>` for label/value pairs, with `<th>` label cells only when `bordered` is on, so the semantics change when you flip a visual flag. Here `<dt>` is the term and `<dd>` the description whether or not there is a border. **The responsive column count is a container query, not a window media query.** Ant resolves `column: { xs: 1, md: 2, lg: 3 }` through `matchMedia` on the viewport; inside a Boxel card that is the wrong box, and a 320px pane on a 5K display gets three columns. **`colon` is opt-in**, because a bordered grid already puts each label in its own tinted cell.

Where it is thinner: **no breakpoint map** — the fold points are the kit's, at 44rem and 26rem, and a caller cannot move them; **no per-item `labelStyle` / `contentStyle`** (the `<:value>` block is the escape hatch for content, and there is none for labels); **no `size` beyond the house scale**; **no `extra` per item**. Ant's `Descriptions.Item` children API is not supported at all — pass `@items`.

## Accessibility

Governing pattern: a description list. There is no APG widget here and the component claims no role beyond the native `<dl>`, `<dt>` and `<dd>`.

What the component does, from its rendered markup and its tests:

- **A `<dl>` in every mode, never a `<table>`.** Each pair is a `<div>` wrapping one `<dt>` and one `<dd>`, valid grouping since HTML 5.2.
- **The colon is decorative:** `aria-hidden='true'`, so a screen reader hears "Lot" and not "Lot colon".
- **A missing value prints the placeholder**, not "undefined".
- **The `<:value>` block replaces the string.**

The caller's failures to avoid: `@title` renders a styled `<div>`, not a heading — if the record has a heading in the page outline, put it in `<:title>`; a `<:value>` holding a control puts that control inside a `<dd>`, which is valid but means the label reaches it only through reading order, not through `<label for>`; and `mono` is a visual treatment for machine values (Appendix J), not a semantic one — a value that is a code or an id should also be a **Token** if it needs to be copied.

## Theming

Consumed directly: `--foreground`, `--muted-foreground`, `--card`, `--border`, `--inset`, `--line-strong`, `--radius-surface`, `--font-serif`, `--font-mono`, `--text-ui-md`, `--text-ui-sm`, `--track-ui`, `--track-heading`, `--space-2`, `--space-4`, `--space-5`.

Its own properties: `--pretui-desc-cols-req` (set from `@columns` on the root), `--pretui-desc-cols` (resolved on the grid and overridden by the container queries), `--pretui-desc-label-w` (set from `@labelWidth`; default `max-content`).

The title is the serif heading voice at 1.5em with `--track-heading`. Labels are `--muted-foreground` at 0.94em; in bordered mode they sit on `--inset` at weight 500 with a `--border` hairline. Density is `@size` on the root `font-size`. A season retunes the whole record through the type tokens and `--inset`; the 44rem and 26rem fold points are fixed.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Ant / Mantine / Chakra | Pretui |
| --- | --- |
| `items` / `data` | `@items` |
| `column` | `@columns` (`@column` accepted) — reduced by the pane, never by the window |
| `layout` / `orientation` | `@layout` |
| `bordered` | `@bordered` |
| `colon` (default true) | `@colon` (default false) |
| `size` | `@size` |
| `title` / `extra` | `@title` or `<:title>`; `<:extra>` |
| `Descriptions.Item` children | not supported; pass `@items` |
