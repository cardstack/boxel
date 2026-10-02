## What it is

A composition shape: a header (eyebrow, title, description, and an action parked at the end edge), an optional full-bleed media band, a body and a footer. This is what a React-trained agent means by `<Card>` — a pricing tile, a settings block, a media object composed by hand.

It is easy to confuse with two neighbours. **CopyFit** is a container-query _identity_: one design that re-cuts itself across badge, strip, tile and card sizes, which is what a Boxel record looks like at whatever size the grid gives it. **Panel** is a _surface_: body, hairline, action bar, with no header/media/footer composition. Card reuses Panel's surface recipe (`--card`, `--radius-surface`, the `--pretui-shadow-*` ladder) rather than inventing a third one. Reach for **Item** for a single row-shaped record, **EmptyState** for a zero-data placeholder, **Result** for an outcome screen, and **Collapsible** when the body should disclose.

## The contract

```
@title?, @description?, @eyebrow?
@tone? (default neutral), @appearance? (default outlined), @size? (default m)
@orientation? | @direction? (default vertical)
@interactive?, @scroll?
<:header>       — replaces the whole generated header
<:title>        — the title line, when it needs markup
<:description>  — the description line, when it needs markup
<:action>       — parked at the header's end edge
<:media>        — full-bleed band before the header (start edge when horizontal)
<:default>      — the body
<:footer>       — the footer band, below a hairline
Element: HTMLElement (the root <section>)
```

**The header is generated from `@title` or `<:title>`, and from nothing else.** A block wins over its arg: `<:title>` over `@title`, `<:description>` over `@description`. Without a title there is no header at all, so `@eyebrow`, `@description` and `<:action>` render nothing on a titleless card. `<:header>` replaces the generated header outright — the eyebrow, title, description and action are all dropped, and the caller owns the markup and the naming.

**The action column is known, not probed.** The header is a grid that gains its second column only when `<:action>` was passed; the component reflects that as `data-has-action` from a block test, so nesting the action inside a wrapper cannot collapse the layout and no `:has()` is involved.

**Regions render in a fixed order**: media, then header, body and footer in a column. In the `vertical` orientation the media band sits _above_ the header; in `horizontal` it takes the start edge (logical, so RTL mirrors) at `--pretui-card-media-size` wide, and the header, body and footer stack beside it.

**`@interactive` does not make the card clickable.** It adds a hover elevation and a `:focus-within` ring so the card reacts as one surface around the control it contains. A card-sized `<button>` around arbitrary content is a nested-interactive trap; the caller's own link or button stays the target.

**`@scroll` scrolls the body, and pins the header and footer.** The caller supplies the height; the body gets `overflow-y: auto` with a stable scrollbar gutter.

`@tone` and `@appearance` are the kit's two axes (`neutral | primary | info | success | warning | danger | attention` × `outlined | filled | filled-outlined | accent | plain`), so a `danger` `filled` card is the same recipe as a `danger` `filled` Button. `@size` takes the house scale and the `sm`/`md`/`lg`/`default` aliases, and sets only the host font-size; every internal dimension is em. `@direction` is an alias for `@orientation` and also accepts `row`/`column`.

Once any named block is present, wrap the body in `<:default>`: loose content beside named blocks passes a local parse and fails the realm transpile.

## Prior art

**shadcn `Card`** is seven `<div>` parts — `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` — with the action column switched on by `has-data-[slot=card-action]:grid-cols-[1fr_auto]`, a `:has()` probe that silently reverts to one column if the action is nested one level deeper. **Mantine `Card`** + `Card.Section` gets full-bleed sections by sniffing `child.type === CardSection` with a `displayName` fallback, so wrapping a section in a memo or HOC stops the trick, and its root is unconditionally `overflow: hidden`. **Chakra `Card`** spells emphasis as `variant` + `colorPalette` resolved in a theme file. **Ant `Card`** takes `title`, `extra`, `cover`, `actions` and `hoverable`; **MUI `Card`** composes `CardHeader`, `CardMedia`, `CardContent`, `CardActions` and `CardActionArea`; **Tremor `Card`** is a decorated surface with a coloured top/left rule.

Where Pretui is better:

- **The title is a heading and names the region.** Every shadcn part is a `<div>`, so a page of cards has no outline and no accessible names. Here the title is an `<h3>` with an id and the `<section>` is `aria-labelledby` it.
- **The root does not clip.** Mantine's `overflow: hidden` clips every Popover, Menu, Tooltip and focus ring rendered inline — and this kit renders overlays in place. Only the media band clips, and it carries its own logical corner radii.
- **Keyboard focus shows.** Every kit's interactive card recipe is a hover shadow; `@interactive` adds the `:focus-within` state that actually exists when a keyboard user is inside.
- **Named blocks cannot be wrapped away**, unlike Mantine's type-sniffed sections, and the action column is a block test rather than a selector probe.
- **Tone is the kit's two-axis grid**, not a colour prop resolved somewhere the component cannot document.

Where it is thinner:

- **No heading-level arg.** The title is always `<h3>`; a card under an `<h3>` section heading needs `<:header>` to supply the right level, which also means supplying the id and naming by hand.
- **No whole-card link.** MUI's `CardActionArea` and Ant's `hoverable` + `onClick` make the surface the target; here that is deliberately absent, and the stretched-link pattern (one link whose `::after` covers the card) is left to the caller.
- **No `extra` / `actions` array.** Ant's footer action row and header `extra` are blocks here, with no divided action-bar layout.
- **No loading state.** Ant's `loading` skeleton has no analogue; compose **Skeleton** into the body.
- **No inset media.** The media band is full-bleed only; Mantine's `inheritPadding` section has no equivalent.

## Accessibility

No APG pattern — a card is a sectioning element, and the component leans on native semantics rather than roles.

- **A titled card is a named region.** The root is a `<section>`; with `@title` or `<:title>` it carries `aria-labelledby` pointing at the generated `<h3>`'s id, which the tests assert. A `<section>` with an accessible name is a `region` landmark, so a grid of twenty titled cards puts twenty landmarks in the rotor. For a long repeated list, prefer **Item** or give the cards a `<:header>` without the naming.
- **An untitled card adds nothing.** No title means no heading and no `aria-labelledby`, so the `<section>` has no name and exposes no landmark; the tests assert there is no dangling reference.
- **`<:header>` hands naming back to the caller.** The generated heading and `aria-labelledby` are both dropped (asserted), so a caller header that should name the card must set `aria-labelledby` itself through `...attributes`.
- **The heading level is fixed at `<h3>`.** Whether that fits the page outline is the caller's problem; nothing adapts it.
- **`@interactive` is presentational.** The card gains no role and no tabindex. The `:focus-within` ring shows keyboard presence, but the control inside must still have its own focus style and accessible name.
- **A scrolling body is not focusable.** `@scroll` sets `overflow-y: auto` without a tabindex, so a body of plain text cannot be scrolled from the keyboard unless the browser makes the scroller focusable itself. Put a focusable element inside, or add `tabindex="0"` and a label on the content.
- **Contrast on `accent` is the caller's to check.** `accent` paints the fill with the tone and sets ink to `--pretui-tone-on`, but the description and eyebrow keep `--muted-foreground`, which is tuned for the `--card` ground, not a saturated fill.
- Motion: the hover shadow transition is removed under `prefers-reduced-motion: reduce`.

## Theming

The per-component knobs: `--pretui-card-pad` (header, body and footer padding, default `1.1em`), `--pretui-card-gap` (header column gap, `0.9em`), `--pretui-card-radius` (defaults to `--radius-surface`; the media band inherits the corners it touches), `--pretui-card-media-size` (media width when horizontal, `34%`), `--pretui-card-bg` (overrides the fill of every appearance except `plain`), `--pretui-card-shadow` (the outlined / filled-outlined hairline) and `--pretui-card-shadow-hover` (the interactive hover).

The surface reads `--card`, `--card-foreground`, `--border`, `--muted-foreground`, `--ring`, `--pretui-shadow-card` and `--pretui-shadow-raised`. Tone resolves through the shared channel `--pretui-tone` / `--pretui-tone-on`, fed from `--primary`, `--pretui-info`, `--success`, `--warning`, `--destructive` and `--pretui-attention` (with their `--pretui-on-*` partners). Size reads `--pretui-size-*` with `--text-ui-*` fallbacks. Type reads `--track-ui`, `--track-heading`, `--track-eyebrow` and `--font-mono`; motion reads `--pretui-dur-snap` and `--pretui-ease-snap`.

Fixed: the title at `1.12em` weight 600, the description at `0.94em`, the footer hairline (a `-1px` inset shadow in `--border`), the `12%` tone mix for `filled` and the `32%` hairline mix for `filled-outlined`.

A season changes every card by retuning `--card`, `--radius-surface` and the shadow ladder, which moves Panel in lockstep. Because the filled recipes mix the tone against `--card`, a dark season gets correct dark tinted cards without a dark-mode branch.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                                | Give them                           |
| ------------------------------------------ | ----------------------------------- |
| `CardHeader` / `CardTitle` / Ant `title`   | `@title` or `<:title>`              |
| `CardDescription` / MUI `subheader`        | `@description` or `<:description>`  |
| `CardAction` / Ant `extra`                 | `<:action>`                         |
| `CardContent`                              | `<:default>`                        |
| `CardFooter` / Ant `actions`               | `<:footer>`                         |
| `CardMedia` / Ant `cover` / `Card.Section` | `<:media>`                          |
| Ant `hoverable` / MUI `CardActionArea`     | `@interactive` (hover + focus ring) |
| Mantine `Paper` / a bare surface           | **Panel**                           |
| A record tile that resizes with its slot   | **CopyFit**                         |
