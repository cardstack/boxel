## What it is

**One adaptive design across four sub-formats** — badge, strip, tile and card — driven entirely by container queries. Use it as the fitted render of a card: the thing that appears in a **Grid**, a search result, a picker row, or a linked-card slot, at whatever size the host gives it. You do not choose the sub-format; the container does. If you need a full identity row with a tag, **EntityDisplay**. If the reference is broken, **BrokenLink**.

## The contract

```
@title: string   (required)
@eyebrow?, @meta?, @media? (image URL), @mediaBg?, @monogram?
@footerLeft?, @footerRight?
<:media>  <:footerLeft>  <:footerRight>
```

**The sub-format is a container query, not an arg.** That is the whole design and it is what "fitted" means in Boxel: the same component renders as a 40px badge in a dense list and as a 300px card in a grid, because the host decides the box and the component decides what fits in it. A format arg would put that decision in the wrong place — the call site rarely knows how big its slot will be.

**Media-forward when media exists; otherwise a monogram.** `@monogram` falls back to the first character of `@title`, then to `'?'` — so a fitted card is never blank, which is the failure mode of every image-first tile when the image is missing.

**`@mediaBg` is a caller string reaching an inline style, and it is validated against the kit allowlist** so it cannot carry its own declarations. That guard is the kit's convention wherever caller data reaches CSS (**Skeleton** does the same with its width/height custom properties), and it is what makes a data-driven background safe.

The footer renders only when `@footerLeft` or `@footerRight` is present.

## Prior art

The Boxel fitted-format system is the direct context: **Grid** sizes its cells from the same fitted-format spec table, so a `regular-tile` here and a `regular-tile` there are the same box.

Against the wider field: **React Spectrum's `Card`** has `size` and `orientation` props — the caller chooses. **shadcn's `Card`** is six sub-components and no adaptivity at all. **Web Awesome `wa-card`** has `appearance` and slot booleans, again caller-chosen.

So the differentiator is real: **every other kit makes the format a prop, and this makes it a measurement.** The payoff is that one component covers four presentations with no call-site branching, and a card dropped into an unfamiliar slot renders sensibly. The cost is that a caller who *wants* the tile treatment in a wide box cannot ask for it — the container decides, and overriding means constraining the container.

Container queries here are **unnamed**, as they must be in realm code: the scoped-CSS transpiler silently drops every rule after a named `@container`, so a single named query would delete the rest of the stylesheet with no error anywhere. Same constraint as **FormLayout** and **Timeline**.

Where it is thin: no interactive state (selected, hovered-as-target), no drag affordance, no badge/count overlay, and no explicit aspect-ratio control for the media region.

## Accessibility

No pattern governs it; it is content layout, and the criteria are WCAG **1.3.1**, **1.1.1 Non-text Content** and **2.4.4 Link Purpose**.

Gaps, and the first two are the ones that bite in practice:

- **`@media` is decorative.** The image renders with `alt=""` and the title is the card's text, so a grid of cards neither repeats the title nor contributes unlabelled images. There is no `alt` arg; an image that carries meaning belongs in the card's own content, not in `@media`.
- **The card is not a link and has no click target.** Interactivity is entirely the host's, which is correct for a presentational component — but it means the usual card-grid failure is available: a click handler on the wrapping `<div>` gives a target that is not focusable, not keyboard-operable and not announced. Wrap it in a real `<a>` or `<button>`, and make sure nothing interactive is inside.
- **The title is not a heading**, so a grid of fitted cards has no structure to navigate by — the same gap **Panel**, **Toolbar**, **EmptyState**, **Stat** and **ResultCard** all share. An authorable heading level is the kit-wide fix.
- **The monogram is a decorative letter** carrying no meaning; it should be `aria-hidden` when the title is present, or it announces as a stray character before the name.
- **Eyebrow, title, meta and footer are four sibling elements with no grouping**, so a screen-reader user hears them as one run.
- **The sub-format changes with the container**, so the visible content changes with size. Content a format drops is removed with `display: none`, never clipped, so a screen reader never announces text no one can see.

## Theming

`--pretui-fitted-mediabg` (the validated media background), `--card` (surface), `--border` and `--pretui-shadow-card` (edge), `--foreground` (title), `--muted-foreground` (eyebrow and meta), `--font-mono` + `--text-ui-xs` + `--track-eyebrow` (the eyebrow voice shared with **Panel**, **Toolbar** and **DataGrid**), plus the type scale per sub-format.

The container-query breakpoints are not tokenised, so a season cannot retune where a strip becomes a tile. The monogram's typography is the one thing worth checking per season — it is a single large letter on a solid ground, and it is the fallback that appears most often in a realm where media is optional.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

Unique to Boxel (container-query badge/strip/tile/card). Not shadcn
`Card`. When an agent asks for a Card they can compose, send them to
the **Card** stub. When they ask for a search-result / linked-card
tile, this is the one.
