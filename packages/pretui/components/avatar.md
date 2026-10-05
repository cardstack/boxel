## What it is

A person or entity as a circle: a photo if there is one, hashed initials if there is not. Use it wherever a record has a human owner — a row's assignee, a comment's author, a presence indicator. For several people in a row, wrap them in **AvatarGroup**. For a record that is not a person, **RecordPill** or **EntityDisplay** carries a name and a type. For a status, **Chip**.

## The contract

```
@name: string   (required)
@src?, @hue?, @size? (px at a 16px root, written as rem; default 24, i.e. 1.5rem)
Element: HTMLSpanElement
```

**`@name` is required even when `@src` is present**, and that is the load-bearing decision: it is the `alt` text on the image, the `title`, the source of the initials fallback, and the seed for the hue. An avatar without a name is a coloured circle, and this component makes that unrepresentable.

**Initials are the first letter of up to two whitespace-separated words**, uppercased. "Ada Lovelace" → "AL", "Cher" → "C", "Jean-Luc Picard" → "JP" (the hyphen is not a separator). Non-Latin scripts get their first two characters, which is right for CJK and wrong for scripts with combining marks — worth knowing before using this for arbitrary user input.

**The hue is `statusHue(@name)`** — the same 32-bit hash used by **StatusChip**, over the name — so a given person is the same colour on every card and in every realm, with no registry. Everything else derives from that hue by `color-mix`: a 16% fill over `--card`, a 20% ink mix, a 28% hairline. Same Law 2 recipe as **Chip**, tuned lighter.

`@size` sets width, height **and** font size (`round(size * 0.42)` to the whole pixel), so initials scale correctly rather than staying 11px in a 48px circle. The number is the diameter in px at a 16px root, and Avatar writes it as `--pretui-avatar-size` in rem (`@size={{40}}` is `2.5rem`), so it follows the root font size. Without `@size`, nothing is written and the size is `--pretui-avatar-size` from the cascade, `1.5rem` by default, so a class, a container query or an ancestor can set it. Give it a `rem`, `px` or container-query length (`cqi`, `cqw`, …). Those keep the 0.42 type ratio. `em` and `%` do not: the font size resolves them against the parent, while the width and height resolve them against the Avatar's own font size and its containing block, so `3em` under a 16px parent is a 60px disc with 20px type.

```css
@container (min-width: 400px) {
  .owner-avatar {
    --pretui-avatar-size: 3rem;
  }
}
```

**`@hue`, `@size` and a caller's `style` work together.** Glimmer lets a caller's `style` attribute replace a component's own, so Avatar also writes `--pretui-avatar-size` and `--pretui-chip-hue` as single properties on top of whatever style the element ends up with, and writes them again if the caller's style changes later. The caller's own declarations are kept, and so is a property another modifier on the element sets, such as boxel-ui's `setCssVar`. If the caller's style sets one of them too, `@size` and `@hue` win, and the caller's value comes back when the arg is cleared. The name-derived hue is a default rather than an arg, so a `--pretui-chip-hue` in the caller's style wins over it. One rewrite is not told apart from another modifier's write: a caller style that sets both properties exactly as Avatar wrote them and changes some other declaration. Its values are not taken as the caller's, so clearing the arg brings back the caller's earlier value.

## Prior art

**Web Awesome `wa-avatar`** takes `image`, `label`, `initials`, `loading` and `shape` (`circle | square | rounded`), with an icon slot as the third fallback tier. **Radix `Avatar`** is `Root`/`Image`/`Fallback` with a `delayMs` on the fallback so a fast-loading image does not flash initials. **React Spectrum `Avatar`** has `src`, `alt`, `size` and `isDisabled`.

Where Pretui is better: **the hue is derived, not chosen.** Web Awesome and Spectrum both give you one neutral avatar colour, so a list of eight initials-only avatars is eight identical grey circles — which defeats the purpose. Deriving the hue from the name makes initials-only avatars genuinely scannable, and it costs no configuration.

Where it is behind, and these are real:

- **No fallback-delay handling.** Radix's `delayMs` exists because rendering initials and then swapping to an image one frame later is a visible flicker in a list. Here the `<img>` renders as soon as `@src` is set, so a slow image shows an empty circle until it loads. A broken image does fall back: its `error` event swaps in the initials for that `@src`, and a new `@src` tries the image again.
- **No `shape` axis** — always a circle.
- **No icon tier** for entities that are not people.
- **No `loading="lazy"`** on the image, which matters in a long list.

## Accessibility

No APG pattern; an avatar is an image or a text fallback.

What is right: `alt={{@name}}` on the image is real alternative text rather than an empty or generic string.

Gaps:

- **The root's `aria-label={{@name}}` sits on a `<span>` with no role.** It names the initials fallback as "Ada Lovelace" rather than the letters "A L" where a screen reader honours it, but `aria-label` on a generic element is prohibited by ARIA and several readers ignore it. A `role='img'` on the initials case would make the name reliable.
- **`title` is the only hover affordance**, which means no touch access, no keyboard access, and UA-controlled presentation.
- **When `@src` _is_ present, the `alt`, the `title` and the root's `aria-label` all carry the name**, so several readers announce it more than once.
- **The avatar is decorative in many contexts and nothing says so.** An Avatar next to a name that is already visible should be `aria-hidden`; there is no `@decorative` arg, so it announces redundantly in exactly the layout where it is most common (**EntityDisplay**, **Feed** rows, comment lists).
- **Contrast**: initials are `color-mix(--foreground 20%, hue)` on a **16%** hue fill — a lighter, lower-contrast pairing than **Chip**'s. At the default 24px the type is ~10px, weight 600, mono. That is small text at low contrast and is a likely **WCAG 1.4.3** failure for pale chart hues. Check all five per season.

## Theming

`--pretui-chip-hue` (set per instance from the name hash — note it reuses **Chip**'s property name, so an ancestor setting `--pretui-chip-hue` for a chip will _not_ affect an Avatar, because the inline style wins), `--pretui-avatar-size` (the diameter; inline only when `@size` is given, otherwise from the cascade with a `1.5rem` fallback), `--card` (mix base and the group ring), `--foreground` (mixed into initials), `--border` (mixed into the hairline), `--primary` (the fallback hue when the name is empty), `--font-mono`.

The 16% / 20% / 28% mix ratios are fixed — unlike **Chip**, whose ratios are tokenised — so a season cannot make avatars more or less saturated. A season or a card can set a default size through `--pretui-avatar-size`; `@size` wins over it. As with **StatusChip**, the palette that matters is `--chart-1` … `--chart-5`, and they must work as a mutually distinguishable set at 16% tint behind small mono type.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

Compose **Badge** / **Indicator** for unread/online. Accept `src` /
`alt` / `fallback` / `name` (initials). **AvatarGroup** is the stack.
