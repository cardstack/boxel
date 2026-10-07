## What it is

A **Chip** whose colour is derived from the value rather than chosen. Pass `@value='In Review'` and you get a chip whose hue is a stable hash of that string — the same status is the same colour on every card, in every list, in every realm, without anyone maintaining a status-to-colour map. Use it for any enumerable state field. If you want to choose the colour, use **Chip** directly (or pass `@hue` here — the escape exists, but it is meant to be the exception). If the value filters a list, **FilterChips**. If it is a machine value, **Token**.

## The contract

```
@value: string   (required)
@hue?            — override; the exception, not the norm
@tone?           — Chip's tone (default neutral)
```

Three args, and the last two you should rarely reach for. A toned StatusChip is outlined in that tone and its dot takes the tone, so `@tone` is for a status whose meaning is fixed, like `live`; the hash hue stays on a neutral chip.

**The hue is a hash, and the hash is the point.** `statusHue()` runs a 32-bit polynomial rolling hash (`h * 31 + charCode`, unsigned) over the string and takes `h % 5` to index `--chart-1` … `--chart-5`. Deterministic, dependency-free, and — the property that matters — **stable across cards, realms and sessions**. No registry, no config, no design review to add a status.

The corollary worth stating plainly: **the hue carries no semantics.** "Failed" is not red because it means failure; it is whatever colour its characters hash to. Five buckets also means collisions are common — with six statuses, two will share a colour. If your states have meaning that must be conveyed by colour (error/warning/success), **the hash is the wrong tool** — pass a `@tone` (StatusChip takes one for a fixed status like `live`, **Chip** for anything else), or use **Alert**.

## Prior art

Nobody else does this, which is either the interesting part or the suspicious part depending on your view.

**Web Awesome `wa-tag`**, **shadcn `Badge`** and **React Spectrum `Badge`** all take a `variant` from a closed semantic enum, and every product using them maintains a `statusColors` map somewhere. **Linear**, **GitHub** and **Jira** all store the colour on the status entity — the colour is data, chosen by a human, persisted alongside the label.

Pretui's bet is different: in a system where cards are authored quickly and a status field's values are whatever an author typed, there is no entity to hang a colour on and no one to choose it. A stable hash gives _consistency_ for free, which is the property that actually makes a list scannable — you learn "green-ish means In Review" within a page, and it stays true everywhere.

Where that bet is better than the alternatives: zero configuration, zero drift, and it works for values the system has never seen. Where it is worse, and it is worth being blunt: **five buckets is a small palette**, collisions are frequent and invisible, and the colour will occasionally be actively misleading — a hash that paints "Cancelled" green is not a bug you can fix without the `@hue` escape. Neither Web Awesome nor Spectrum has that failure mode.

The pragmatic guidance: use StatusChip for open-ended categorical fields, and a `@tone` for anything where the colour is load-bearing.

## Accessibility

No APG pattern; it is text with a background and carries no role — correct.

Everything **Chip** says applies, and one thing more, which is the important one:

- **Colour conveys nothing here, and that is a feature.** Because the hue is a hash, it is _not_ meaningful, so a user who cannot perceive it loses nothing that the label does not already carry. That makes StatusChip trivially **WCAG 1.4.1** compliant in a way that a semantic-colour chip is not — the label is always the message.
- **Contrast does not depend on the hue.** The text is Chip's `--foreground` on `--muted` (or a tone's `-ink` on `--card`), at **11px, weight 500**; the hash hue only colors the dot, so no `--chart-*` value can make the label illegible.
- **The dot inherits from Chip and is on by default**, giving each hue a saturated anchor. Since the hues are arbitrary, the dot is doing less work here than it does on a semantic Chip — but it still helps distinguish adjacent chips whose fills are close.
- **The chip has no relationship to the field it describes.** "In Review" announced next to a record name is loose text; put it in a **KeyValue** row or a **FormField** static block if the property name matters.
- **No `aria-label` and no title.** The value is the visible text and the accessible text, which is right.
- Nothing is focusable.

## Theming

Inherits **Chip**'s entire token set; `--pretui-chip-hue` is set here from the hash.

The theme's `--chart-1` through `--chart-5` color the dots, and this component is the reason those five need to work as a _set_: they appear side by side in a list, assigned arbitrarily, so they must be mutually distinguishable as small dots on `--muted`.
