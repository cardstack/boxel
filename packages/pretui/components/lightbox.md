## What it is

A thumbnail gallery whose tiles open into a full-screen viewer with pinch-zoom, pan and keyboard navigation.

It owns the zoom engine, which is why **Gallery** does not: running two lightboxes over one set is how focus restoration breaks. Wire Gallery's `@onOpen` here, or use this on its own when the grid *is* the presentation.

## The contract

```
@assets           — the gallery (LightboxAsset[]); non-image assets are dropped
@sections?         — {title?, caption?, assets}[]: one grid per chapter, ONE viewer over all of them
@layout?           — 'grid' (default) | 'justified': equal-height rows, edge to edge, uncropped
@rowHeight?        — target row height for 'justified'. Default 'clamp(96px, 16vw, 200px)'
@thumbnailSizes?   — `sizes` for tiles with a thumbnailSrcset. Default '(max-width: 600px) 50vw, 25vw'
@filmstrip?        — a thumbnail rail along the bottom of the open viewer. Default false
@download?         — a save button in the viewer's toolbar. Default false
@columns?          — fixed column count; omit for a responsive auto-fill grid
@minTile?          — minimum tile width for the responsive grid. Default '160px'
@gap?              — gap between tiles. Default '10px'
@loop?             — wrap from the last image to the first. Default true
@counter?          — show the "3 / 8" counter. Default true
@zoom?             — offer the zoom button. Default true
@bgOpacity?        — backdrop opacity, 0–1. Default 1
@caption?          — (asset) => string for the open image; defaults to its alt text
@onOpen?, @onChange?, @onClose?

<:section as |section index|> — heads each section; defaults to its title and caption
<:empty> — replaces the built-in empty state
```

**Responsive sources, in the grid and in the viewer.** A `LightboxAsset` is a media asset that can also carry `thumbnailSrcset` (the tile's candidates) and `srcset` (the open image's). Tiles take `sizes` from `@thumbnailSizes`, so a phone's 90-pixel-tall row fetches a 480-wide thumbnail rather than the desktop's 720. The open image's set rides on the link as `data-pswp-srcset`, and PhotoSwipe sizes it to the width it actually displays, raising it as the reader zooms, so a phone opens a 1280 copy and only fetches the original when it zooms past it. The filmstrip rail draws from the tile set too. An asset without sets renders exactly as before.

**`@sections` keeps one viewer across chapters.** One Lightbox per chapter means a swipe stops dead at the end of each one; a sectioned Lightbox renders a grid per chapter but hands PhotoSwipe the whole set, so the reader swipes from the last arrival straight into the first speech. Tile positions ("34 of 108") run across the set for the same reason.

**`'justified'` is the layout for mixed orientations.** In the default grid every tile keeps its own ratio in a column, so a portrait tile makes its row taller and leaves holes under its landscape neighbours. Justified rows share one height and fill the width, and nothing is cropped — the Google Photos / Flickr layout.

**`@filmstrip` and `@download` are the phone-photos conventions**: a rail to jump through a long set, the current photo wider and lit and kept centred; and a save link with `download` on the open photo's full-size file. Both hide with the rest of the chrome when a tap toggles it.

**Escape belongs to the open viewer.** It is caught at the window in the capture phase while the viewer is open, so a host that binds Escape on the document (Boxel's card stack closes the card on it) never sees the keypress that closed a photo.

**Images only, and it says what it dropped.** A set containing a video or a PDF renders the images and reports the count it discarded, rather than silently presenting a smaller gallery as if that were the whole set.

**Each tile reserves its own aspect ratio**, so the grid does not reflow as thumbnails arrive.

**The grid is responsive by default.** `@columns` is the opt-in to a fixed layout.

## Prior art

**PhotoSwipe 5.4.4** (MIT, vendored), which provides the zoom, pan, keyboard navigation and the modal dialog itself.

Three integration decisions are worth knowing, because each is a trap:

- **The gallery is anchors, not buttons.** PhotoSwipe binds to `<a href>` children, and that choice pays twice: the markup degrades to "open the file" with no JavaScript at all, and the tile is reachable, focusable, middle-clickable and copy-link-able for free. A grid of `<div onclick>` — which is what most lightbox demos ship — has none of that.
- **The stylesheet is refcounted, not module-installed.** PhotoSwipe appends its root to `document.body`, outside every component subtree, so scoped CSS cannot reach it and a side-effect `.css` import breaks realm indexing. The CSS travels as a string and is installed into `document.head` by the *first* Lightbox and removed by the *last*. A module-level "install once" flag would leak a stylesheet across test modules — exactly the cross-file coupling that makes one test's failure depend on another's.
- **The engine lives in a modifier and only in a modifier**, constructed in the modifier body and destroyed in its destructor, so nothing builds it in a getter where the indexer could evaluate it outside a browser.

Where it is thinner: images only — no video slides, which PhotoSwipe itself supports — no share sheet, and no deep-linking to a particular slide.

## Accessibility

- **Every tile is a real link.** Tab reaches it, Enter opens it, the context menu offers "copy link", and with scripting off it still goes somewhere. That is a larger accessibility win than any ARIA attribute on this component.
- **Each tile is named by its position** in the set, so a screen-reader user knows where they are in the grid before opening anything.
- **The open viewer is PhotoSwipe's modal dialog**, which brings its own focus trap, Escape handling and arrow-key navigation — inherited rather than re-implemented, and the reason this component refuses to coexist with a second engine.
- **Captions default to the image's alt text**, so a described image is described in the viewer too, and `@caption` overrides only when the viewer needs different words from the grid.
- **Dropped assets are counted out loud.** A user is told the set was filtered rather than being shown a quietly incomplete gallery.
- **`@bgOpacity` below 1 lets the page show through the backdrop**, which reduces the contrast of the viewer's own controls — worth checking if you lower it.

## Theming

`--pretui-lb-columns`, `--pretui-lb-min`, `--pretui-lb-gap` and `--pretui-lb-row` (the grid, from `@columns`, `@minTile`, `@gap` and `@rowHeight`), `--pretui-lb-section-gap` (between sections), `--pretui-lb-ratio` (per tile), `--pretui-on-neutral` for ink over a thumbnail, `--pretui-shadow-hairline`.

The open viewer is styled by PhotoSwipe's own stylesheet, which the season does not reach — the deliberate consequence of the refcounted install. So a season retunes the grid, and the full-screen view stays the library's neutral dark. That is the trade for not having a stylesheet leak across the realm.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
