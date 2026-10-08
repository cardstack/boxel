## What it is

**Callout** is **Alert** under the name Tremor and Web Awesome (`wa-callout`) use. The export is the same class. Import it when a port already says Callout; the **Alert** writeup carries the depth, and the page-level outcome scene is **Result**, the transient one **Toast**.

## The contract

```
@tone?      — info · success · warning · danger, plus the React spellings
              (destructive / error → danger, positive → success, notice → warning)
@title?
@variant?   — shadcn's one-enum spelling: default | destructive
@toneLabel? — the hidden tone word a screen reader hears first
              (default Info / Success / Warning / Error)
<:default>  — the message, as prose
<:action>   — an optional control beside it
```

Identical to Alert. Tones outside the four fall back to `info` rather than emitting a dead `data-tone`.

## Prior art

**Tremor `Callout`** takes `color` from its full palette and an `icon` prop; **Web Awesome `wa-callout`** has `variant` (brand / neutral / success / warning / danger), `appearance` (accent / filled / outlined / plain) and `size`, with an icon slot. Alert has four tones, one appearance, and an icon fixed per tone — no icon slot and no size. What Alert does that neither does: the `alert` / `status` politeness split by tone, so an info banner never interrupts. shadcn's `Alert` hardcodes `role="alert"` on every tone; Alert does not.

## Accessibility

Governing pattern: APG **Alert**. `role="alert"` for `danger`, `role="status"` otherwise, both with implicit `aria-atomic`. The tone glyph is `aria-hidden`, and since the role only singles out `danger`, a visually hidden tone word is read in its place, so a warning is announced as "Warning: Credit is running low". `@toneLabel` replaces the word. The live region mounts together with its content, so a banner that appears complete is announced less reliably than one written into an existing region — render it from first paint and toggle the content when the announcement matters. No dismiss control, so nothing to make keyboard-reachable.

## Theming

`--info`, `--success`, `--warning`, `--destructive` (the four tone hues); `--foreground` (text); `--info-foreground`, `--success-foreground`, `--warning-foreground`, `--destructive-foreground` (the icon's ink on its disc); `--card` (the mix base), `--border` (mixed into the hairline), and the `--boxel-sp-*`, `--boxel-border-radius` and `--boxel-font-size-xs` tokens for geometry and type. The 20% tint strength is the component's own `--pretui-alert-mix`. A dark theme must define the four hues at a luminance that survives a 20% mix against a dark `--card`.

## React ecosystem

| Tremor / Web Awesome / shadcn | Pretui Callout          |
| ----------------------------- | ----------------------- |
| `color` / `variant` / `tone`  | `@tone`                 |
| `title`                       | `@title`                |
| children                      | `<:default>`            |
| `icon` / icon slot            | fixed per tone; no slot |
| `appearance` / `size`         | not supported           |
