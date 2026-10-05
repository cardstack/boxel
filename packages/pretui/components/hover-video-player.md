## What it is

A video preview that plays on intent: hover it or focus it and the clip runs, leave and it stops. The pattern every media gallery uses to let a still stand in for a video without making you open it.

Use it for a tile in a shelf or a grid. For a video someone is actually watching, that is **VideoPlayer**.

## The contract

```
@src (required)   — the preview clip
@label (required) — what the preview is OF; names the play control and the figure
@poster?          — the still shown before and after playback
@ratio?           — aspect ratio reserving the box. Default '16 / 9'
@muted?           — keep it silent. Default true
@loop?            — loop the preview. Default true
@rewind?          — return to the first frame when the preview stops. Default true
@playOnIntent?    — preview on hover and focus. Default true
@caption?         — caption rendered under the frame
@onPlayingChange? — fires whenever playback starts or stops

<:overlay> — content laid over the frame: a duration chip, a title
```

**`@muted` defaults to true, and an unmuted hover preview is hostile.** Sound that starts because a pointer crossed a tile is the thing everyone hates about autoplaying video.

**The box is reserved by `@ratio` before anything loads**, so a shelf of previews does not reflow as posters arrive.

**Focus is an intent, not only hover.** A keyboard user tabbing to the tile gets the same preview a pointer user gets, which is the whole reason `@playOnIntent` covers both.

**Reduced motion is checked**, so a reader who has asked for less movement is not ambushed by a clip that starts because their pointer passed over it.

**The video is `preload='metadata'`**, so a shelf of previews costs metadata rather than bytes until something is hovered.

## Prior art

**cult-ui's `hover-video-player`** is the source.

Where Pretui is better: **focus drives the preview too**, where upstream is pointer-only — which means on upstream a keyboard user simply cannot see the preview at all. **Reduced-motion readers get intentional playback rather than ambush video.** And the frame is a real `<figure>` with a real `<figcaption>`, so the caption is associated rather than merely adjacent.

Where it is thinner: no hover-intent delay, so a pointer sweeping across a shelf starts and stops several previews in a row; no unmute affordance, since the preview is muted and stays that way; no scrubbing or seeking; and no thumbnail-strip preview on hover, which is the richer version of this pattern. The preview is also a separate clip from whatever the full video is — there is no contract tying the two together.

## Accessibility

- **The `<video>` is `aria-hidden` and `tabindex='-1'`.** It is a moving poster, not a control, and exposing it would put a second unlabelled media element in the accessibility tree beside the button that actually operates it.
- **The toggle is a real button with `aria-pressed`** and an accessible name derived from `@label`, so the preview can be started and stopped by keyboard without relying on focus-to-play.
- **`@label` is required by the type**, because it names both the figure and the control — an unlabelled video is an unlabelled control.
- **The toggle's glyphs are `aria-hidden` with `focusable='false'`**, so the state comes from `aria-pressed` rather than from a symbol, and the SVG never takes a tab stop in older browsers.
- **`<figure>`/`<figcaption>`** associates the caption with the preview.
- **Motion starts without a click by design**, which is exactly why the reduced-motion check matters. `@playOnIntent={{false}}` turns the tile into a still with a play button, which is the right choice in a dense grid.

## Theming

`--pretui-hvp-ratio` (the reserved box, written from `@ratio` through the kit's CSS guard, so a nonsense ratio drops its declaration and the stylesheet's `16 / 9` stands).

The rest — the toggle's surface, the overlay scrim, the caption's ink — comes from the kit's shared control and surface tokens rather than from a component-specific set, so a preview tile in a shelf matches the cards around it without per-season work.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
