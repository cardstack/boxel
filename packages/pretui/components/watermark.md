## What it is

A **repeated faint mark over a region**: DRAFT across an invoice, a reviewer's name across a preview, CONFIDENTIAL across a report. It is texture, never information (Law 6). A glance at a screenshot tells you the document is a draft, and a screen reader hears nothing. When the state matters, say it in words too, with a **Chip** or a banner.

For decorative texture with no text, use the kit's texture primitives. For an image background, use **AspectRatio**'s painted modes.

## The contract

```
@text?, @image?
@gap? (px, default 140), @rotate? (degrees, default -22)
@opacity? (0–0.4, default 0.08), @fontSize? (px, default 14)
<:default>   — the region under the mark
Element: HTMLDivElement
```

**Text is an SVG mask; the ink is a theme colour.** The text is drawn once into an SVG tile of `@gap` pixels, rotated by `@rotate`, and used as a repeating `mask-image` over a layer painted with `--pretui-watermark-ink`. The colour is never baked into a data URI, so a dark season gets a light mark with no extra work. The text is XML-escaped and capped at 80 characters, counted by code point so an emoji is never cut in half.

**`@image` tiles an image instead**, as `background-image`, at `@gap` pixels.

**Every source goes through the url guard.** The generated SVG and any `@image` reach CSS only through `cssUrl` from **AspectRatio**, which admits `http:`, `https:`, `blob:` and `data:image/` and rejects anything that could break out of `url("…")`. A rejected image draws nothing.

**It never gets in the way.** The layer is `aria-hidden`, has `pointer-events: none` and covers the region with `inset: 0`. The content underneath stays selectable and clickable. The numeric args are clamped. Opacity stops at 0.4, because a mark that competes with the text is no longer texture.

## Prior art

**Ant `Watermark`** takes `content` (string or lines), `image`, `gap`, `rotate`, `font`, `zIndex` and `offset`, and draws on a canvas. It also uses a MutationObserver to redraw the layer if someone deletes it. **Mantine** has none. Most agents hand-roll a rotated, repeated background.

Where Pretui is better: **the ink follows the theme** instead of a fixed `rgba` fill, and **the source is guarded**. Ant builds a data URL from a canvas, which is fine, but hand-rolled versions interpolate text straight into CSS.

Where it is thinner: **it is not tamper-resistant.** There is no observer re-inserting the layer, so a watermark is a signal, not a security control. **Single-line text only**, and **no font args** beyond size.

## Accessibility

No APG pattern.

- **The layer is `aria-hidden`.** The tests assert it, and that the content renders and stays readable.
- **It must not be the only signal.** Anything the reader needs to know goes in text on the page. The usage page pairs the mark with a Draft chip.
- **Contrast fails on purpose.** At 0.08 opacity the mark is well below any text contrast ratio, so it never competes with the content. The 0.4 cap keeps it that way.
- **Markup in `@text` is escaped**, not injected. The tests assert it.

## Theming

`--pretui-watermark-ink` (the text mark's colour, default `--foreground`). Opacity, spacing, rotation and size are args, not tokens, because they belong to the document, not the season.

In print, the layer keeps its colour with `print-color-adjust: exact`, so a DRAFT mark survives printing.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                       | Give them                              |
| --------------------------------- | -------------------------------------- |
| Ant `<Watermark content="DRAFT">` | `<Watermark @text='DRAFT'>`            |
| Ant `image`                       | `@image`                               |
| Ant `gap={[100, 100]}` / `rotate` | `@gap={{100}}` / `@rotate`             |
| Ant `font={{ color, fontSize }}`  | `--pretui-watermark-ink` / `@fontSize` |
| a CSS repeating background        | `<Watermark>`                          |
