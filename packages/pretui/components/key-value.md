## What it is

A two-column definition list: property names on the left, values on the right. Use it for the read view of a record — metadata panels, detail sidebars, a card's summary. If the values are editable, use **FormField** with `@static` (or **RecordDetail**, which is the whole record-page pattern). If the data is a list of _rows_ rather than one object's properties, that is **DataGrid** or **Table**.

## The contract

```
@items: { key: string; value: string }[]   (required)
<:value as |item|>   — optional per-row override
Element: HTMLDListElement
```

**It renders a real `<dl>`/`<dt>`/`<dd>`**, which is the correct markup for name/value pairs and is what most implementations of this pattern get wrong (a grid of `<div>`s carries no relationship).

**The two-column alignment is `grid-template-columns: max-content 1fr` on the `<dl>` itself**, with the `<dt>`/`<dd>` pairs flowing into it. That is the good version of this layout: keys size to the longest key and stop, values take the rest, and every row aligns — without a fixed label width, without a wrapper per row, and without the `<dl>` losing its semantics to a `display: flex` on each pair. `align-items: center` means a single-line key sits centred against a multi-line value.

**`<:value>` is the escape hatch that makes it useful.** `@items` types values as strings, but the block yields the whole item, so a row's value can be a **Token**, a **StatusChip**, an **Avatar** or a link. Note the type still says `string` — the block is how you get past that, and the item's own `value` property is then effectively a key you read yourself.

## Prior art

**SLDS's `description-list`** is the closest — horizontal and stacked variants over a real `<dl>`. **Web Awesome**, **Radix** and **React Spectrum** all ship nothing here; Spectrum's guidance is to use a `Grid` with `Text` pairs. **shadcn** has no equivalent; the community recipe is a `<dl>` with Tailwind grid classes.

So this is another case of "everyone writes it by hand", and the improvements over the hand-rolled version are concrete:

- **Real `<dl>` semantics with grid alignment.** The usual hand-rolled version either uses `<div>`s (losing semantics) or puts `display: flex` on each `<dt>`/`<dd>` pair (losing column alignment across rows). The `max-content 1fr` grid on the list keeps both.
- **`max-content` rather than a fixed label width**, so a panel of short keys is not padded to fit a hypothetical long one. Compare **FormLayout**'s `horizontal` direction, which uses a fixed `9rem` label column because its labels sit beside _controls_ that need a stable left edge — the two are different problems and get different answers, deliberately.
- **`Token`'s flush-margin rule is coordinated with this component**: `:where(td, dd) > .pretui-token` drops the token's side margins, so ids in a `<dd>` align with the column edge. That kind of cross-component detail is what a kit buys you over a snippet.

Where it is thin: **no stacked/narrow mode.** At a narrow container the `max-content 1fr` grid holds two columns and squeezes the values; SLDS has a stacked variant and this has no container query. That is the most visible gap in a side panel.

## Accessibility

No APG pattern. `<dl>` is a semantic structure, governed by WCAG **1.3.1 Info and Relationships**.

What is right, and it is most of the value:

- **`<dl>`/`<dt>`/`<dd>` gives a real programmatic association** between name and value. Screen readers announce the pairing, and many announce the list's item count on entry. This is the single reason to use this component over a grid of divs.
- **The grid layout does not break the semantics.** `display: grid` on a `<dl>` with `<dt>`/`<dd>` as direct children is well-supported and preserves the list's accessibility tree in current browsers — worth knowing, because putting a wrapper `<div>` around each pair (the obvious way to lay this out) _does_ break it in some readers.

Gaps:

- **No accessible name for the list.** A card with three KeyValue lists gives three unnamed definition lists. There is no `@label` arg; pass `aria-label` through `...attributes`, or precede it with a heading.
- **Values are plain text with no type information.** A date, an id and a name are announced identically. Using `<:value>` to wrap machine values in **Token** (`<code>`) gives the reader a hint; nothing does it for you.
- **No empty-value handling.** An item with `value: ''` renders an empty `<dd>`, announced as nothing — indistinguishable from a value the reader missed. **FormField** has `@emptyText` (default `'—'`) for exactly this; KeyValue has no equivalent and should.
- **Long values do not truncate and keys do not wrap-protect.** A very long key expands the `max-content` column and squeezes every value in the list, which at narrow widths becomes a **WCAG 1.4.10 Reflow** problem — there is no stacked fallback.
- **12px keys in `--muted-foreground`** against `--card` is at the edge of **1.4.3**; check per season.
- Nothing is focusable, correctly — unless you yield interactive content into `<:value>`, which then joins the tab order in reading order.

## Theming

`--muted-foreground` (keys), `--text-ui` (12px, keys), `--text-ui-md` (12.5px, values), `--space-6` (the column gap, 19px), and a fixed 7px row gap.

Only four tokens, and the layout is entirely `max-content 1fr` — so a season's control over this component is limited to ink and the column gap. There is no way to switch to a stacked layout, set a fixed key column, or right-align keys through tokens.

Because keys use `--muted-foreground` and values inherit `--foreground`, the key/value distinction is carried by ink weight and size alone. A season that compresses its grey ramp will make the two columns read as one; keep at least a step between them.
