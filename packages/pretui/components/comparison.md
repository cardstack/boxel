## What it is

A before/after reveal split by a draggable seam: two full-bleed layers, one clipped to the seam, and a slider that moves it.

Both panes are yielded blocks, so it compares *any* content — two themed states of a component, two renderings, two revisions — not only two images.

## The contract

```
@value?         — seam position 0–100, percent from the left; omit for uncontrolled
@onValueChange? — fires with the requested position
@label?         — accessible name for the seam. Default 'Comparison position'

<:before> full-bleed layer that sizes the host and shows right of the seam
<:after>  full-bleed layer, clipped to the left of the seam
```

**`<:before>` sizes the host.** The after layer is clipped over it, so the component's dimensions come from the before pane and the two must be the same size to compare honestly.

**The seam rests at the middle** and moves by keyboard as well as pointer: arrows step by one, Shift+arrow by ten, Home and End go to the edges. Everything is clamped to 0–100 and reported.

**A controlled `@value` holds the seam still and reports the request.** The component does not move itself when controlled, which is the kit's standard controlled contract and the behaviour a test can rely on.

## Prior art

**Web Awesome's `wa-comparison`** and **motion-primitives' `ImageComparison`** — two similar surfaces split by a draggable seam.

Where Pretui is better: **arbitrary content panes.** Both upstreams take images; here the blocks accept anything, which is what makes it useful for comparing two themed component states rather than only two photographs. The reveal is `clip-path` driven by a custom property, so it is all paint and no measurement.

Where it is thinner: **no vertical seam** — the split is horizontal only, where `wa-comparison` offers both. There is **no hover-follow mode**, which motion-primitives has; that is deliberate, since a seam that tracks the pointer without a press is hard to hold still. And there is no initial-position arg beyond controlling `@value` from the first render, so "start at 30%" means owning the state.

## Accessibility

- **The seam is a `role='slider'`** with `aria-label`, `aria-valuemin='0'`, `aria-valuemax='100'` and a rounded `aria-valuenow`, so the position is announced as a percentage rather than as a pixel offset.
- **One tab stop**, and the full arrow/Shift/Home/End contract over it — the same keyboard model as every other slider in the kit.
- **The handle's glyph is `role='presentation'`**, including the SVG path inside it, so the chevrons never reach the accessibility tree.
- **The value is rounded before it is announced.** A seam at 47.3187% is announced as 47, because the fractional part is noise to a listener.
- **The comparison itself is visual.** Two panes differing only by appearance are not perceivable without sight, and the slider's value says where the seam is, not what changed. If the difference matters, it needs describing in text nearby — the component cannot do that for you.

## Theming

`--pretui-comparison-seam-w` (the seam's width) and `--pretui-comparison-handle-size` (the grip), plus `--pretui-primary-ink` for both, `--pretui-shadow-card` for the grip's elevation, and `--pretui-dur-snap` / `--pretui-ease-snap` for the glide as the seam moves.

Riding the shared snap duration and easing is what makes the seam feel like the rest of the kit rather than like a bespoke drag surface — a season that changes how things snap changes this with it.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
