## What it is

A thumbnail gallery whose tiles open into a full-screen viewer with pinch-zoom, pan and keyboard navigation.

It owns the zoom engine, which is why **Gallery** does not: running two lightboxes over one set is how focus restoration breaks. Wire Gallery's `@onOpen` here, or use this on its own when the grid *is* the presentation.

## The contract

```
@assets (required) — the gallery; non-image assets are dropped
@columns?          — fixed column count; omit for a responsive auto-fill grid
@minTile?          — minimum tile width for the responsive grid. Default '160px'
@gap?              — gap between tiles. Default '10px'
@loop?             — wrap from the last image to the first. Default true
@counter?          — show the "3 / 8" counter. Default true
@zoom?             — offer the zoom button. Default true
@bgOpacity?        — backdrop opacity, 0–1. Default 1
@caption?          — (asset) => string for the open image; defaults to its alt text
@onOpen?, @onChange?, @onClose?

<:empty> — replaces the built-in empty state
```

**Images only, and it says what it dropped.** A set containing a video or a PDF renders the images and reports the count it discarded, rather than silently presenting a smaller gallery as if that were the whole set.

**Each tile reserves its own aspect ratio**, so the grid does not reflow as thumbnails arrive.

**The grid is responsive by default.** `@columns` is the opt-in to a fixed layout.

## Prior art

**PhotoSwipe 5.4.4** (MIT, vendored), which provides the zoom, pan, keyboard navigation and the modal dialog itself.

Three integration decisions are worth knowing, because each is a trap:

- **The gallery is anchors, not buttons.** PhotoSwipe binds to `<a href>` children, and that choice pays twice: the markup degrades to "open the file" with no JavaScript at all, and the tile is reachable, focusable, middle-clickable and copy-link-able for free. A grid of `<div onclick>` — which is what most lightbox demos ship — has none of that.
- **The stylesheet is refcounted, not module-installed.** PhotoSwipe appends its root to `document.body`, outside every component subtree, so scoped CSS cannot reach it and a side-effect `.css` import breaks realm indexing. The CSS travels as a string and is installed into `document.head` by the *first* Lightbox and removed by the *last*. A module-level "install once" flag would leak a stylesheet across test modules — exactly the cross-file coupling that makes one test's failure depend on another's.
- **The engine lives in a modifier and only in a modifier**, constructed in the modifier body and destroyed in its destructor, so nothing builds it in a getter where the indexer could evaluate it outside a browser.

Where it is thinner: images only — no video slides, which PhotoSwipe itself supports — no thumbnail rail inside the open viewer, no share or download affordance, and no deep-linking to a particular slide.

## Accessibility

- **Every tile is a real link.** Tab reaches it, Enter opens it, the context menu offers "copy link", and with scripting off it still goes somewhere. That is a larger accessibility win than any ARIA attribute on this component.
- **Each tile is named by its position** in the set, so a screen-reader user knows where they are in the grid before opening anything.
- **The open viewer is PhotoSwipe's modal dialog**, which brings its own focus trap, Escape handling and arrow-key navigation — inherited rather than re-implemented, and the reason this component refuses to coexist with a second engine.
- **Captions default to the image's alt text**, so a described image is described in the viewer too, and `@caption` overrides only when the viewer needs different words from the grid.
- **Dropped assets are counted out loud.** A user is told the set was filtered rather than being shown a quietly incomplete gallery.
- **`@bgOpacity` below 1 lets the page show through the backdrop**, which reduces the contrast of the viewer's own controls — worth checking if you lower it.

## Theming

`--pretui-lb-columns`, `--pretui-lb-min` and `--pretui-lb-gap` (the grid, from `@columns`, `@minTile` and `@gap`), `--pretui-lb-ratio` (per tile), `--pretui-on-neutral` for ink over a thumbnail, `--pretui-shadow-hairline`.

The open viewer is styled by PhotoSwipe's own stylesheet, which the season does not reach — the deliberate consequence of the refcounted install. So a season retunes the grid, and the full-screen view stays the library's neutral dark. That is the trade for not having a stylesheet leak across the realm.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
