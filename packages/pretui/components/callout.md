## What it is

**Callout** is **Alert** under the name Tremor and Web Awesome (`wa-callout`) use. The export is the same class. Import it when a port already says Callout; the **Alert** writeup carries the depth, and the page-level outcome scene is **Result**, the transient one **Toast**.

## The contract

```
@tone?      — info · success · warning · danger, plus the React spellings
              (destructive / error → danger, positive → success, notice → warning)
@title?
@variant?   — shadcn's one-enum spelling: default | destructive
<:default>  — the message, as prose
<:action>   — an optional control beside it
```

Identical to Alert. Tones outside the four fall back to `info` rather than emitting a dead `data-tone`.

## Prior art

**Tremor `Callout`** takes `color` from its full palette and an `icon` prop; **Web Awesome `wa-callout`** has `variant` (brand / neutral / success / warning / danger), `appearance` (accent / filled / outlined / plain) and `size`, with an icon slot. Alert has four tones, one appearance, and a glyph fixed per tone — no icon slot and no size. What Alert does that neither does: the `alert` / `status` politeness split by tone, so an info banner never interrupts. shadcn's `Alert` hardcodes `role="alert"` on every tone; Alert does not.

## Accessibility

Governing pattern: APG **Alert**. `role="alert"` for `warning` and `danger`, `role="status"` otherwise, both with implicit `aria-atomic`. The live region mounts together with its content, so a banner that appears complete is announced less reliably than one written into an existing region — render it from first paint and toggle the content when the announcement matters. The tone glyph is literal text and is not `aria-hidden`. No dismiss control, so nothing to make keyboard-reachable.

## Theming

`--pretui-info`, `--success`, `--warning`, `--destructive` for the four tone hues; `--card` as the mix base, `--foreground` mixed into title and body, `--border` into the hairline, `--pretui-chip-mix` for the tint strength shared with **Chip**, `--text-ui-md`. A dark season must define the four hues at a luminance that survives a 20% mix against a dark `--card`.

## React ecosystem

| Tremor / Web Awesome / shadcn | Pretui Callout          |
| ----------------------------- | ----------------------- |
| `color` / `variant` / `tone`  | `@tone`                 |
| `title`                       | `@title`                |
| children                      | `<:default>`            |
| `icon` / icon slot            | fixed per tone; no slot |
| `appearance` / `size`         | not supported           |
