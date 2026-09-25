## What it is

A record's identity row: a visual (icon or thumbnail) beside a title, an optional tag **Chip**, and a subtitle or meta line. Use it as the standard way a card, a person, a file or a linked record is presented in a list, a search result, a picker row or a header. If the record is a compact inline reference inside prose or a field, that is **RecordPill**. If it is a full tile, **FittedCard**. If the reference is broken, **BrokenLink**.

## The contract

```
@title?, @subtitle?, @tag?
@variant? 'icon' | 'thumbnail'   (default 'icon')
@center?, @underline?
<:visual>  <:meta>
Element: HTMLElement
```

**`@variant` changes the visual slot's dress, not its content.** You always supply the visual through `<:visual>`; `icon` sizes and pads it as a glyph, `thumbnail` as an image. That factoring is why one component replaces two.

**`<:meta>` beats `@subtitle`.** When the second row needs real markup — a **RelativeTime**, a **Token**, two facts separated by a dot — use the block; when it is a string, use the arg. The block-wins precedence mirrors the boxel-ui originals this merges, so a port from either behaves the same.

`@center` centres the whole row (for a card header rather than a list row); `@underline` adds the hover underline that signals the row is a link target.

## Prior art

This is a **fresh merge of boxel-ui's `entity-icon-display` and `entity-thumbnail-display`** into one component, with the tag row reusing Pretui's **Chip**. Two components differing only in how their visual slot is dressed is exactly the kind of duplication a `@variant` axis exists to remove.

Against the field: **React Spectrum** has no entity display; the closest is a `ListView` `Item` with `Text`/`Image` slots. **Web Awesome** has none. **shadcn** has none — the recipe is a flex row with an avatar and two spans, rewritten in every project. **SLDS's `media-object`** is the closest named pattern, and this is essentially that plus a tag.

Where making it a component pays off is the same argument as **Toolbar**'s: the details every hand-rolled media row gets wrong — the title truncating rather than the visual shrinking, the subtitle's ink and size, the tag's alignment — are decided once. And because the tag is a **Chip** rather than a bespoke pill, a tag here and a status elsewhere are visibly the same object.

Where it is thin: **no trailing/actions slot.** A list row almost always wants something on the right — a chevron, a **Menu**, a count — and there is no block for it, so you wrap the whole thing in your own flex row. That is the clearest addition. Also no size axis, and no selected/active state.

## Accessibility

No pattern governs it; it is content layout, subject to WCAG **1.3.1** and **2.4.4 Link Purpose**.

Gaps, and the first two matter most because of where this component is used:

- **`@underline` implies the row is clickable, but nothing here makes it a link.** The component renders a `<div>`; the interactivity is entirely the caller's. The failure mode is the standard card-row one: a click handler on the wrapper `<div>` gives a target that is not focusable, not keyboard-operable and not announced as actionable. If an EntityDisplay is clickable, wrap it in a real `<a>` or `<button>`, and make sure it is not _also_ containing one.
- **The visual is whatever you yield, and nothing enforces its alt text.** A thumbnail `<img>` with no `alt` announces its filename; an icon with a `<title>` announces twice. For a decorative visual beside a title that already names the record, `aria-hidden` on the visual is usually correct — and nothing prompts for it.
- **Title, tag and subtitle are three sibling elements with no grouping.** A screen-reader user hears "Q3 Report Draft 3 days ago" as one run with no indication of which part is a status and which is a timestamp. **Chip**'s own note applies: a chip has no relationship to the property it is the value of.
- **The title is not a heading.** In a card header (`@center`) that is often what it should be, and there is no `@headingLevel` — the same gap **Panel**, **Toolbar** and **EmptyState** have.
- **Truncation behaviour is unstated** — check whether a long title ellipsizes without a full-text fallback, which is the **Toolbar** problem again.
- The subtitle's `--muted-foreground` at small size is the usual **1.4.3** thing to verify per season.

## Theming

`--foreground` (title), `--muted-foreground` (subtitle and meta), plus **Chip**'s full token set for the tag and whatever the visual brings. `data-variant` and `data-center` are reflected on the root, so a season can dress icon rows and thumbnail rows differently without the component exposing more args.

The visual slot's icon and thumbnail sizes are fixed per variant. Because the tag is a real **Chip**, a season that retunes `--pretui-chip-mix` moves entity tags along with every other chip — which is the intent, and worth knowing if you were about to tune chips for a status list and forgot they also appear here.
