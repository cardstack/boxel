## What it is

A definition list of property names and their values: by default in two columns, names on the left and values on the right, or stacked, or inline as a wrapping strip. Use it for the read view of a record — metadata panels, detail sidebars, a card's summary. If the values are editable, use **FormField** with `@static` (or **RecordDetail**, which is the whole record-page pattern). If the data is a list of _rows_ rather than one object's properties, that is **DataGrid** or **Table**.

## The contract

```
@items: { key: string; value: string }[]   (required)
@layout?: 'horizontal' | 'stacked' | 'inline'   (default 'horizontal'; 'vertical' = 'stacked')
@labelStyle?: 'default' | 'eyebrow'   (default 'default')
@divided?: boolean   (default false; horizontal layout only)
@valueAlign?: 'start' | 'end'   (default 'start'; horizontal layout only)
<:value as |item|>   — optional per-row override
Element: HTMLDListElement
```

**It renders a real `<dl>`/`<dt>`/`<dd>`**, which is the correct markup for name/value pairs and is what most implementations of this pattern get wrong (a grid of `<div>`s carries no relationship).

**The two-column alignment is `grid-template-columns: max-content 1fr` on the `<dl>` itself**, with the `<dt>`/`<dd>` pairs flowing into it. That is the good version of this layout: keys size to the longest key and stop, values take the rest, and every row aligns — without a fixed label width, without a wrapper per row, and without the `<dl>` losing its semantics to a `display: flex` on each pair. `align-items: center` means a single-line key sits centered against a multi-line value.

**`@layout` picks one of three arrangements**, landing as `data-layout`:

- `'horizontal'` (the default) is the two-column grid above.
- `'stacked'` puts each key above its value in a single column, for a narrow side panel or a value too long to sit beside its key. `'vertical'` is accepted as an alias. The markup stays a flat run of `<dt>`/`<dd>`.
- `'inline'` sets the pairs side by side on one line and wraps them onto the next when space runs out, for a compact strip such as a period's start, end and term. Each pair sits in a `<div>`, so a key always wraps together with its value. HTML allows a `<div>` around each `<dt>`/`<dd>` group in a `<dl>`, and the list keeps its semantics.

**`@labelStyle='eyebrow'`** sets the keys in the theme's eyebrow role: the `--boxel-eyebrow-*` font, size, weight, line height and tracking, uppercase. Inside a card those come from the card's theme, and outside one from the `theme.css` defaults. It lands as `data-label-style`.

**`@divided`** draws a `--border` hairline between rows that runs unbroken across both columns: the row and column gaps move into the cells as padding, so nothing breaks the line. It is the same name List and PageScaffold use for their row rules, and it lands as `data-divided`.

**`@valueAlign='end'`** aligns the values to the inline end of their column, landing as `data-value-align`. With `@divided` it gives the spec-sheet / detail-panel look; each works without the other. Only `'horizontal'` takes either arg; the other layouts ignore them.

**The keys' typography has its own properties**, `--pretui-kv-label-*` (see Theming). Set them on the KeyValue, through a class, or on any ancestor; they win over `@labelStyle`. A caller restyles the keys this way rather than reaching into the `<dt>` with `:deep()`.

**`<:value>` is the escape hatch that makes it useful.** `@items` types values as strings, but the block yields the whole item, so a row's value can be a **Token**, a **StatusChip**, an **Avatar** or a link. An item may carry fields of its own beyond `key` and `value` (a code, an id, a flag), and the block is given the item typed as passed, so it reads them without a cast.

## Prior art

**SLDS's `description-list`** is the closest — horizontal and stacked variants over a real `<dl>`. **Web Awesome**, **Radix** and **React Spectrum** all ship nothing here; Spectrum's guidance is to use a `Grid` with `Text` pairs. **shadcn** has no equivalent; the community recipe is a `<dl>` with Tailwind grid classes.

So this is another case of "everyone writes it by hand", and the improvements over the hand-rolled version are concrete:

- **Real `<dl>` semantics with grid alignment.** The usual hand-rolled version either uses `<div>`s (losing semantics) or puts `display: flex` on each `<dt>`/`<dd>` pair (losing column alignment across rows). The `max-content 1fr` grid on the list keeps both.
- **`max-content` rather than a fixed label width**, so a panel of short keys is not padded to fit a hypothetical long one. Compare **FormLayout**'s `horizontal` direction, which uses a fixed `9rem` label column because its labels sit beside _controls_ that need a stable left edge — the two are different problems and get different answers, deliberately.
- **`Token`'s flush-margin rule is coordinated with this component**: `:where(td, dd) > .pretui-token` drops the token's side margins, so ids in a `<dd>` align with the column edge. That kind of cross-component detail is what a kit buys you over a snippet.

Where it is thin: **the layout does not adapt to its container.** `@layout='stacked'` matches SLDS's stacked variant, but the caller picks it; at a narrow container the default `max-content 1fr` grid still holds two columns and squeezes the values, since there is no container query to stack it automatically.

## Accessibility

No APG pattern. `<dl>` is a semantic structure, governed by WCAG **1.3.1 Info and Relationships**.

What is right, and it is most of the value:

- **`<dl>`/`<dt>`/`<dd>` gives a real programmatic association** between name and value. Screen readers announce the pairing, and many announce the list's item count on entry. This is the single reason to use this component over a grid of divs.
- **The grid layout does not break the semantics.** `display: grid` on a `<dl>` with `<dt>`/`<dd>` as direct children is well-supported and preserves the list's accessibility tree in current browsers — worth knowing, because putting a wrapper `<div>` around each pair (the obvious way to lay this out) _does_ break it in some readers.

Gaps:

- **No accessible name for the list.** A card with three KeyValue lists gives three unnamed definition lists. There is no `@label` arg; pass `aria-label` through `...attributes`, or precede it with a heading.
- **Values are plain text with no type information.** A date, an id and a name are announced identically. Using `<:value>` to wrap machine values in **Token** (`<code>`) gives the reader a hint; nothing does it for you.
- **No empty-value handling.** An item with `value: ''` renders an empty `<dd>`, announced as nothing — indistinguishable from a value the reader missed. **FormField** has `@emptyText` (default `'—'`) for exactly this; KeyValue has no equivalent and should.
- **Long values do not truncate and keys do not wrap-protect.** A very long key expands the `max-content` column and squeezes every value in the list, which at narrow widths becomes a **WCAG 1.4.10 Reflow** problem. `@layout='stacked'` or `'inline'` avoids it, but the default layout does not switch on its own.
- **Keys in `--muted-foreground` have less contrast margin than the values.** The default keys are in the ui-label role (0.75rem with the default theme). `@labelStyle='eyebrow'` sets them smaller, at the eyebrow role's 0.6875rem and uppercase, in the same `--muted-foreground`. That is still normal-size text, so the bar stays 4.5:1 and the smaller size leaves less margin. With the default theme the key ink is 6.91:1 against `--card` and `--background` in light, and 5.57:1 against `--card` and 7.61:1 against `--background` in dark, so both key styles pass. Inside a themed card the card's theme sets the ink; check it there.
- Nothing is focusable, correctly — unless you yield interactive content into `<:value>`, which then joins the tab order in reading order.

## Theming

`--muted-foreground` and the ui-label role (`--boxel-ui-label-*`) for the keys, `--boxel-sp-lg` (the column gap, and the gap between inline pairs) and `--boxel-sp-2xs` (the row gap). With `@divided`: `--border` for the hairlines and `--boxel-sp-xs` for each row's block padding. The values set no typography of their own, so they inherit the surrounding text: the body role inside a card. The eyebrow keys read `--boxel-eyebrow-font-family`, `--boxel-eyebrow-font-size`, `--boxel-eyebrow-font-weight`, `--boxel-eyebrow-line-height` and `--boxel-eyebrow-letter-spacing`.

The keys' own properties, each unset by default:

- `--pretui-kv-label-color` (unset: `--muted-foreground`)
- `--pretui-kv-label-font-family` (unset: `--boxel-ui-label-font-family`)
- `--pretui-kv-label-font-size` (unset: `--boxel-ui-label-font-size`)
- `--pretui-kv-label-font-weight` (unset: `--boxel-ui-label-font-weight`)
- `--pretui-kv-label-line-height` (unset: `--boxel-ui-label-line-height`)
- `--pretui-kv-label-letter-spacing` (unset: `--boxel-ui-label-letter-spacing`)
- `--pretui-kv-label-text-transform`

`--pretui-kv-pad-inline` (default `0`, so nothing moves) insets the text from the container's inline edges without insetting the `@divided` hairlines. In the horizontal layout the keys pad their start edge and the values their end edge, so each hairline still runs the full width of the container. In `'stacked'` every key and value pads both sides, and in `'inline'` the strip pads its own start and end. Set it on the KeyValue or any ancestor, for example inside a card or a `Panel` with no body padding. Padding the `<dl>` instead would inset the hairlines too.

With `@labelStyle='eyebrow'`, the unset typography properties take the eyebrow role instead and the text transform becomes uppercase. The color stays `--muted-foreground`.

The arrangement is `@layout`, not a token, and there is still no way to set a fixed key column or right-align keys (`@valueAlign` moves the values only).

Because keys use `--muted-foreground` and values inherit `--foreground`, the key/value distinction is carried by ink, weight and size. A theme that compresses its gray ramp will make the two columns read as one; keep at least a step between them.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
