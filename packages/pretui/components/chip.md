## What it is

A small pill for a categorical value: a status, a tag, a label. It is display only — no click, no dismiss, no selection. Use it wherever a value is a _category_ rather than a number or a name. If the dot's hue should be derived from the value automatically, use **StatusChip**, which is this component with `statusHue()` applied. If the value is machine-readable (an id, a hash, a path), use **Token**, which is the mono jewelry treatment. If the pill filters a list, use **FilterChips**. If it represents a record, **RecordPill**.

## The contract

```
@label?, @tone? (default neutral), @hue?, @dot? (default true)
<:default>   — used when @label is absent
```

**Tone outlines, hue colors the dot.** A neutral chip (the default) is the theme's `--muted` surface with `--foreground` text. Any other `@tone` outlines it on `--card` instead: the tone's `-ink` (`--success-ink`, `--destructive-ink` for `danger`…) for the text and the ring, and the tone itself for the dot, the same tone names and inks Button and Alert use. `@hue` recolors only the dot (any CSS color, or a `var(--chart-3)`).

**The dot is on by default.** That is the decision most kits get backwards: without it, a row of chips is distinguished only by fill colour, and colour alone is a WCAG 1.4.1 problem _and_ hard to scan. The dot gives the hue a saturated anchor next to muted ink, so the category reads at a glance even when the fills are close. Turn it off (`@dot={{false}}`) only when the chip's own text already names the category unambiguously.

## Prior art

**Web Awesome `wa-tag`** takes `variant` (brand/success/neutral/warning/danger), `appearance` (accent/filled/outlined/plain), `size` and `with-remove` — a closed enum of five semantic colours plus a removable mode. **shadcn `Badge`** is `default | secondary | destructive | outline`, a `cva` map. **React Spectrum** splits it in two: `Badge` (static, eleven `variant` colours) and `Tag`/`TagGroup` (interactive, removable, selectable, with keyboard navigation).

Where Pretui is better: **the hue is open, and the treatment is derived.** Every kit above enumerates its colors, so a chip for "Region: EMEA" has to be shoehorned into `secondary` or a new variant added. Here you pass a hue — most usefully one of the `--chart-*` tokens — and it colors the dot, while the text stays the theme's guaranteed pair. Adding a category costs nothing.

Where it is thinner, and the gaps are real: **no remove affordance** (Web Awesome and Spectrum both have one, and it is the single most-requested chip feature), **no size axis**, **no icon slot** (the dot is the only leading element), and **no interactive mode** — Spectrum's `TagGroup` with its roving tabindex and Delete-key removal has no analogue here. Reach for **FilterChips** or **RecordPill** when you need behaviour.

## Accessibility

No APG pattern — a Chip is text with a background, and correctly carries no role.

That is the right answer for a static chip, and it means the accessibility questions are all about _composition_:

- **The dot is an empty `<span>` with no `aria-hidden`.** It contributes nothing to the announced text (there is nothing in it), so this is correct in effect, though an explicit `aria-hidden="true"` would be clearer about intent.
- **The chip's meaning must survive without colour.** `@label` carries it, so a chip reading "Blocked" is fine; a chip reading "3" whose colour means severity is a **WCAG 1.4.1** failure. The component cannot enforce this, and it is the most common way chips go wrong.
- **The chip has no accessible relationship to what it describes.** A status chip next to a record name is announced as loose adjacent text. If the chip _is_ the value of a labelled property, put it inside a **KeyValue** or a **FormField**'s static block so the label reaches it.
- **Text contrast is a guaranteed theme pair**: `--foreground` on `--muted` for a neutral chip, the tone's `-ink` on `--card` for a toned one, at **11px, weight 500**, the same for every hue. The dot is decorative; a pale hue makes a faint dot, never faint text.
- **`white-space: nowrap`** means a long label overflows rather than wraps. Chips are for short values; nothing enforces that.
- Nothing is focusable, which is correct — there is nothing to do.

## Theming

`--muted` / `--foreground` (a neutral pill and its text), `--card` with each tone's `--x-ink` (text and ring) and `--x` (dot) for a toned chip, `--pretui-chip-hue` (the dot, defaulting to `--muted-foreground`, or the tone on a toned chip), `--boxel-border-radius-xs`, `--boxel-font-size-2xs`, `--boxel-lsp-xs`, and the `--boxel-sp-*` spacing scale. `--pretui-chip-height` and `--pretui-chip-dot-size` set the pill height and dot size.

A theme restyles every chip through `--muted` and `--foreground`, and the dot colors through the `--chart-*` tokens. Dark mode needs nothing extra: the theme's dark `--muted` / `--foreground` pair applies.

`--pretui-chip-mix` and `--pretui-ink-mix` are legacy knobs that tint a neutral chip's surface and text toward `--pretui-chip-hue`; they are kept for callers that still set them, and new code uses `@tone`.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                    | Give them                  |
| ------------------------------ | -------------------------- |
| Badge (inline, shadcn)         | this tile / **StatusChip** |
| Badge (count overlay, MUI/Ant) | **Badge** stub             |
| Tag / Pill                     | this tile                  |
| Indicator / dot                | **Indicator** stub         |
