# CS-13969: a keyboard path for the film frame's resize grip

## Goal

The corner grip on a film's demo page (`packages/choreo-gallery/realm/shell/film-stage.gts`) resizes the frame by drag only. Give it a keyboard path and a size a screen reader can follow.

## Design

- The grip becomes a `<div role='slider' tabindex='0'>`. A screen reader in browse mode hands the arrow keys to a focused slider, which it would not do for a plain button, and speaks the slider's value as it changes.
- The keys follow the ARIA slider pattern: Right and Up grow the frame, Left and Down shrink it, Home takes it to the floor and End to the well. A step is 16px, 64px with Shift. Each step keeps the drag's floor (384 × 216), its ceiling (the well), and its no-portrait rule (height never exceeds width). Reaching the ceiling on both axes clears the override, as a drag does.
- Enter or Escape snaps back to the well's size. With the frame already at that size they do nothing and propagate, so Escape still reaches the host.
- `aria-valuetext` reads `W × H` for a hand-set frame, or `W × H, default size` for the well's own size. `aria-valuenow`/`aria-valuemax` carry the width. A `ResizeObserver` on the well keeps the default size current.
- The visible `W × H` readout shows during keyboard stepping as well as during a drag. It is `aria-hidden`, because the slider's value already speaks it.
- The grip's focus-ring contrast is a separate ticket (CS-14000) and stays out of this change.

## Files

- `packages/choreo-gallery/realm/shell/film-stage.gts`
- `packages/choreo-gallery/realm/gallery.test.gts`: a new `film frame` module

## Testing

- The new test gives the well a fixed 1000 × 600 size inline, since `boxel test` delivers no component stylesheet. It steps the grip with the arrows and Shift, checks the floor, the ceiling and the no-portrait rule, checks Escape and Enter resets and the stored size, and checks that Escape at the default size propagates.
- `pnpm lint` and `boxel test realm` in `packages/choreo-gallery`.
