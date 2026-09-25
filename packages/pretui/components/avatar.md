## What it is

A person or entity as a circle: a photo if there is one, hashed initials if there is not. Use it wherever a record has a human owner — a row's assignee, a comment's author, a presence indicator. For several people in a row, wrap them in **AvatarGroup**. For a record that is not a person, **RecordPill** or **EntityDisplay** carries a name and a type. For a status, **Chip**.

## The contract

```
@name: string   (required)
@src?, @hue?, @size? (default 24)
Element: HTMLSpanElement
```

**`@name` is required even when `@src` is present**, and that is the load-bearing decision: it is the `alt` text on the image, the `title`, the source of the initials fallback, and the seed for the hue. An avatar without a name is a coloured circle, and this component makes that unrepresentable.

**Initials are the first letter of up to two whitespace-separated words**, uppercased. "Ada Lovelace" → "AL", "Cher" → "C", "Jean-Luc Picard" → "JP" (the hyphen is not a separator). Non-Latin scripts get their first two characters, which is right for CJK and wrong for scripts with combining marks — worth knowing before using this for arbitrary user input.

**The hue is `statusHue(@name)`** — the same 32-bit hash used by **StatusChip**, over the name — so a given person is the same colour on every card and in every realm, with no registry. Everything else derives from that hue by `color-mix`: a 16% fill over `--card`, a 20% ink mix, a 28% hairline. Same Law 2 recipe as **Chip**, tuned lighter.

`@size` sets width, height **and** font size (`round(size * 0.42)`), so initials scale correctly rather than staying 11px in a 48px circle.

## Prior art

**Web Awesome `wa-avatar`** takes `image`, `label`, `initials`, `loading` and `shape` (`circle | square | rounded`), with an icon slot as the third fallback tier. **Radix `Avatar`** is `Root`/`Image`/`Fallback` with a `delayMs` on the fallback so a fast-loading image does not flash initials. **React Spectrum `Avatar`** has `src`, `alt`, `size` and `isDisabled`.

Where Pretui is better: **the hue is derived, not chosen.** Web Awesome and Spectrum both give you one neutral avatar colour, so a list of eight initials-only avatars is eight identical grey circles — which defeats the purpose. Deriving the hue from the name makes initials-only avatars genuinely scannable, and it costs no configuration.

Where it is behind, and these are real:

- **No fallback-delay handling.** Radix's `delayMs` exists because rendering initials and then swapping to an image one frame later is a visible flicker in a list. Here `{{#if @src}}` renders the `<img>` immediately, so a slow or **broken image URL shows a blank circle** — there is no `onerror` fallback to initials at all. That is the most consequential gap: a dead avatar URL produces an empty ring, not a name.
- **No `shape` axis** — always a circle.
- **No icon tier** for entities that are not people.
- **No `loading="lazy"`** on the image, which matters in a long list.

## Accessibility

No APG pattern; an avatar is an image or a text fallback.

What is right: `alt={{@name}}` on the image is real alternative text rather than an empty or generic string.

Gaps:

- **The initials fallback has no accessible name.** When `@src` is absent, the element is a `<span>` containing "AL" — announced as the letters "A L", not as "Ada Lovelace". The `title` attribute holds the full name, but `title` on a non-interactive `<span>` is announced inconsistently and often not at all. An `aria-label={{@name}}` on the root would fix it in one attribute and is the clearest thing to change.
- **`title` is the only hover affordance**, which means no touch access, no keyboard access, and UA-controlled presentation.
- **When `@src` _is_ present, both the `alt` and the `title` carry the name**, so several readers announce it twice.
- **The avatar is decorative in many contexts and nothing says so.** An Avatar next to a name that is already visible should be `aria-hidden`; there is no `@decorative` arg, so it announces redundantly in exactly the layout where it is most common (**EntityDisplay**, **Feed** rows, comment lists).
- **Contrast**: initials are `color-mix(--foreground 20%, hue)` on a **16%** hue fill — a lighter, lower-contrast pairing than **Chip**'s. At the default 24px the type is ~10px, weight 600, mono. That is small text at low contrast and is a likely **WCAG 1.4.3** failure for pale chart hues. Check all five per season.
- **A broken image is a silent blank** (above) — an accessibility failure as well as a visual one, since the `alt` disappears with the rendered image in most browsers only if the `<img>` fails _and_ has no alt; here the alt does surface, which mitigates it for screen-reader users but not for sighted ones.

## Theming

`--pretui-chip-hue` (set per instance from the name hash — note it reuses **Chip**'s property name, so an ancestor setting `--pretui-chip-hue` for a chip will _not_ affect an Avatar, because the inline style wins), `--card` (mix base and the group ring), `--foreground` (mixed into initials), `--border` (mixed into the hairline), `--primary` (the fallback hue when the name is empty), `--font-mono`.

The 16% / 20% / 28% mix ratios are fixed — unlike **Chip**, whose ratios are tokenised — so a season cannot make avatars more or less saturated. `@size` is an arg, not a token, so a season cannot set a default size either. As with **StatusChip**, the palette that matters is `--chart-1` … `--chart-5`, and they must work as a mutually distinguishable set at 16% tint behind small mono type.

## React ecosystem

Compose **Badge** / **Indicator** for unread/online. Accept `src` /
`alt` / `fallback` / `name` (initials). **AvatarGroup** is the stack.
