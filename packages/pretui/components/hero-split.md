## What it is

The split hero: an eyebrow, a headline, a lead paragraph and a chip strip on one side, a media stage on the other.

## The contract

```
@eyebrow?  — small line above the headline
@headline (required) — the block's accessible name
@lead?     — one paragraph under the headline
@chips?    — the chip strip. Data, never markup
@asset?    — the media stage's asset; routed by MediaViewer, which reserves the
             space before it loads
@mediaSide? — which side the media sits on VISUALLY at wide widths. Default 'end'
@ratio?    — hold the stage at a fixed CSS aspect-ratio; omit and the stage takes
             the asset's own
@headingLevel? — heading level for the headline in the host page
```

**`@headline` is required because it is the block's accessible name.** A hero with no headline is a picture with some chips next to it.

**`@mediaSide` moves the media visually and never in source order.** Content comes first in the DOM regardless, so reading order is stable whichever side the picture is on — the same rule **StepsWithMedia** follows.

**`@chips` is data, never markup.** A chip strip built from blocks is a chip strip that will eventually contain a link, a button and a nested component; keeping it typed keeps it a strip.

**The stage reserves its space before the asset loads**, so a hero does not reflow under the reader — which matters most here, because a hero is the first thing on the page.

## Prior art

The split hero on every marketing page.

Where Pretui is better: the source-order guarantee and the heading level as an argument. Both are the things that break when a hero is hand-built and then reused on a second page with a different outline.

Where it is thinner: one media stage, no video background, no call-to-action model — actions are the caller's to place — and no alternating layout across stacked heroes.

## Accessibility

- **The headline is a real heading at `@headingLevel`**, so a hero participates in the document outline rather than being large text.
- **Source order is content-first regardless of `@mediaSide`**, which means a screen reader gets the headline before the picture on both variants.
- **`@eyebrow` is context, not a heading**, so it does not compete in the outline.
- **The media carries its own alt text through MediaViewer**; a hero image with none is announced as an unnamed graphic.
- **Chips are text**, announced after the lead, rather than being decorative shapes.

## Theming

The block composes **MediaViewer** and the kit's **Chip**, and takes the shared block spacing and heading tokens.

A hero with its own type scale is how a marketing page ends up looking like two products — which is why the headline's size comes from the season's scale at the given heading level rather than from a hero-specific token.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
