## What it is

The metadata panel for an asset: kind, dimensions, duration, size, captions, then whatever the caller attached — rendered as a **KeyValue** table under a heading.

It is the companion to **MediaViewer** rather than part of it. A viewer shows the asset; this describes it. **AssetWell** and **Gallery** pair the two.

## The contract

```
@asset (required) — a MediaAssetSpec; resolved here, so the same spec the viewer takes
@title?           — heading above the rows. Default 'Details'
@metaOnly?        — hide the derived rows and show only asset.meta. Default false
<:footer>         — extra rows or controls under the table
```

**Rows are derived, and a row it cannot fill does not appear.** Kind is always present, translated to a word — "3D model" rather than `model`, "File" for an unknown kind. Dimensions appear only when both are known, duration only when there is one, size only when the byte count formats to something, captions only when the asset has tracks. There is no "—" and no empty row.

**Caller metadata is appended, never merged.** Everything in `asset.meta` lands after the derived rows in its own key order, so a caller cannot accidentally shadow a derived row — and `@metaOnly` drops the derived ones entirely when the host already shows them elsewhere.

**Machine values are rendered as Tokens.** Dimensions, Size, Duration and Format take the mono treatment through the **KeyValue** value slot; everything else is prose. That distinction is the panel's one styling opinion, and it is what makes `1920 × 1080` scannable next to a sentence.

**Bytes are formatted in binary units** — KB meaning 1024 — because that is what a file manager shows, and an asset panel that disagrees with Finder is noise.

## Prior art

A kit addition. The comparison is against the metadata sidebar every digital-asset manager ships, and the two things those usually get wrong: rows that render as empty when the value is missing, so the panel is mostly dashes; and every value in the same voice, so a filename, a resolution and a description are visually identical.

Where Pretui is better: absent rows are absent, and machine values are typographically distinct from prose without the caller tagging them.

Where it is thinner: the row set is fixed — there is no way to reorder, relabel or hide a single derived row short of `@metaOnly`, which drops all of them. Values are strings only, so a caller cannot supply a link, a chip or a nested component as a value; `<:footer>` is the escape hatch, and it lands under the table rather than in it. There is no copy affordance on any value, which is the most obvious omission for a panel whose contents people paste elsewhere.

## Accessibility

- **The panel is a `<section>` with an `aria-label` taken from `@title`**, so it is a named region a screen-reader user can find and skip. A caller who passes a `@title` is naming a landmark, which is worth knowing when several inspectors sit on one page — several regions all called "Details" is the failure mode.
- **The heading is a real `<h3>`**, and the asset's label sits beside it as text rather than as a second heading, so the document outline gets one entry per panel rather than two.
- **The table is KeyValue's**, so the key/value association is whatever that component provides — this panel does not re-implement it.
- **Nothing is conveyed by colour or position alone.** Machine values differ from prose by typeface, and each still carries its key.
- **Nothing is focusable** unless the `<:footer>` block puts something focusable there.

## Theming

`--pretui-shadow-hairline` for the panel's edge, `--pretui-on-neutral` for the header ink, and the **KeyValue** and **Token** treatments for everything inside.

There is almost no surface of its own, which is the intent: an inspector is a table with a heading, and a season that retunes KeyValue and Token retunes every metadata panel in the product with it. `--pretui-assets-tile` and `--pretui-assets-aspect` are shared with the other components in this module, so an inspector sitting beside an **AssetGrid** inherits the same geometry.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
