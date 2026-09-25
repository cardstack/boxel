## What it is

A small tinted pill for a categorical value: a status, a tag, a label. It is display only — no click, no dismiss, no selection. Use it wherever a value is a _category_ rather than a number or a name. If the hue should be derived from the value automatically, use **StatusChip**, which is this component with `statusHue()` applied. If the value is machine-readable (an id, a hash, a path), use **Token**, which is the mono jewelry treatment. If the pill filters a list, use **FilterChips**. If it represents a record, **RecordPill**.

## The contract

```
@label?, @hue?, @dot? (default true)
<:default>   — used when @label is absent
```

**One hue in, a complete treatment out.** This is the kit's Law 2 and Chip is its purest expression: `@hue` sets a single custom property and the stylesheet derives everything with `color-mix` — a 20% tint over `--card` for the fill, a 45% mix with `--border` for the hairline, a 34% mix with `--foreground` for the ink, and the hue neat for the dot. There are no variants and no colour enum. Passing any CSS colour, or any `var(--chart-3)`, produces a complete, coherent chip.

**The dot is on by default.** That is the decision most kits get backwards: without it, a row of chips is distinguished only by fill colour, and colour alone is a WCAG 1.4.1 problem _and_ hard to scan. The dot gives the hue a saturated anchor next to muted ink, so the category reads at a glance even when the fills are close. Turn it off (`@dot={{false}}`) only when the chip's own text already names the category unambiguously.

The mix ratios are tokens (`--pretui-chip-mix`, `--pretui-ink-mix`), shared with **Alert**, so a banner and a chip about the same thing tint identically.

## Prior art

**Web Awesome `wa-tag`** takes `variant` (brand/success/neutral/warning/danger), `appearance` (accent/filled/outlined/plain), `size` and `with-remove` — a closed enum of five semantic colours plus a removable mode. **shadcn `Badge`** is `default | secondary | destructive | outline`, a `cva` map. **React Spectrum** splits it in two: `Badge` (static, eleven `variant` colours) and `Tag`/`TagGroup` (interactive, removable, selectable, with keyboard navigation).

Where Pretui is better: **the hue is open, and the treatment is derived.** Every kit above enumerates its colours, so a chip for "Region: EMEA" has to be shoehorned into `secondary` or a new variant added. Here you pass a hue — most usefully one of the five `--chart-*` tokens — and get a correct fill, ink and hairline for it automatically. Adding a category costs nothing.

Where it is thinner, and the gaps are real: **no remove affordance** (Web Awesome and Spectrum both have one, and it is the single most-requested chip feature), **no size axis**, **no icon slot** (the dot is the only leading element), and **no interactive mode** — Spectrum's `TagGroup` with its roving tabindex and Delete-key removal has no analogue here. Reach for **FilterChips** or **RecordPill** when you need behaviour.

## Accessibility

No APG pattern — a Chip is text with a background, and correctly carries no role.

That is the right answer for a static chip, and it means the accessibility questions are all about _composition_:

- **The dot is an empty `<span>` with no `aria-hidden`.** It contributes nothing to the announced text (there is nothing in it), so this is correct in effect, though an explicit `aria-hidden="true"` would be clearer about intent.
- **The chip's meaning must survive without colour.** `@label` carries it, so a chip reading "Blocked" is fine; a chip reading "3" whose colour means severity is a **WCAG 1.4.1** failure. The component cannot enforce this, and it is the most common way chips go wrong.
- **The chip has no accessible relationship to what it describes.** A status chip next to a record name is announced as loose adjacent text. If the chip _is_ the value of a labelled property, put it inside a **KeyValue** or a **FormField**'s static block so the label reaches it.
- **Contrast is derived, not verified.** Ink is `color-mix(--foreground 34%, hue)` on a `color-mix(hue 20%, --card)` background at **11px, weight 500**. That is the kit's smallest text on a tinted ground, and it is the most likely **1.4.3** failure in the ink territory. A pale `--chart-*` hue produces pale ink on a pale fill; check all five chart hues per season, not just one.
- **`white-space: nowrap`** means a long label overflows rather than wraps. Chips are for short values; nothing enforces that.
- Nothing is focusable, which is correct — there is nothing to do.

## Theming

`--pretui-chip-hue` (the per-instance hue, defaulting to `--muted-foreground`), `--pretui-chip-mix` (fill strength, default 20%, shared with **Alert**), `--pretui-ink-mix` (ink strength, default 34%), `--card` (the mix base), `--foreground` (mixed into ink), `--border` (mixed into the hairline), `--radius-chip` (6px), `--text-ui-xs`, `--track-ui`.

The 18px height, 7px padding and 5px dot are fixed.

A season retunes every chip in the product through `--pretui-chip-mix` and `--pretui-ink-mix`, and defines the palette through `--chart-1` … `--chart-5`. Because every derived colour mixes against `--card`, a dark season gets correct dark chips automatically — but it must pick chart hues that survive a 20% mix against a dark `--card`, or all five chips converge on the same near-black pill and the dot becomes the only distinction.

## React ecosystem

| Agent types                    | Give them                  |
| ------------------------------ | -------------------------- |
| Badge (inline, shadcn)         | this tile / **StatusChip** |
| Badge (count overlay, MUI/Ant) | **Badge** stub             |
| Tag / Pill                     | this tile                  |
| Indicator / dot                | **Indicator** stub         |
