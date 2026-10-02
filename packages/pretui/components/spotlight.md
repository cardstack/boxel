## What it is

A pointer-anchored highlight washing a surface: a soft light under the content that follows the pointer and travels to whatever child takes focus.

Use it to make a surface feel live under the cursor — a pricing card, a feature panel, a call to action. The content stays fully interactive; the light is underneath it.

## The contract

```
@size?        — diameter of the light in px. Default 260
@hue?         — any CSS colour for the light; defaults to --primary
@intensity?   — peak strength at the centre, 0–1. Default 0.5
@rest?        — opacity floor when nothing is engaged, 0–1. Default 0.34
@restX?       — resting x origin as a fraction of the surface width. Default 0.5
@restY?       — resting y origin as a fraction of the surface height. Default 0.5
@followFocus? — travel the light to a focused child on focusin. Default true

<:default> — the lit surface's content; sits above the light, fully interactive
```

**`@rest` is the resting state, and setting it to 0 makes the component invisible in a still frame.** A spotlight that only exists while a pointer is over it is a spotlight that does not exist in a screenshot, in a print, or for anyone who never hovers.

**`@followFocus` is the keyboard path.** The light travels to a focused child, so tabbing through a lit surface moves the light the way hovering does. This is what stops the effect from being pointer-only decoration.

**The content sits above the light and stays interactive.** The light is a sibling layer, not an overlay.

**An unsafe hue is dropped** rather than interpolated, and the default token stands.

## Prior art

**motion-primitives' Spotlight**, plus **react-bits' TargetCursor** and **ClickSpark** as neighbours in the same idea.

Where Pretui is better: **the resting floor and the focus travel.** Upstream spotlights are pointer-only and fully transparent at rest, which means they contribute nothing to a still frame and nothing to a keyboard user. Both are fixed here by default rather than by configuration. The hue also goes through the kit's colour guard rather than into a template string.

Where it is thinner: one light per surface, no multiple or coloured-per-child lights, no click burst, and no blend-mode control — the wash is a fixed compositing choice. There is no cursor-replacement mode either, which is what TargetCursor does.

## Accessibility

- **The light is `aria-hidden`.** It is a wash under content and contributes nothing to the tree.
- **`@followFocus` is the reason this is not pointer-only.** A keyboard user gets the same emphasis a mouse user gets, arriving at the same places — which is unusual for this family of effects and is the single most valuable thing about this implementation.
- **The resting floor means the surface is never unstyled.** A reader who has not moved a pointer still sees a lit surface rather than a flat one.
- **Contrast changes under the light.** Text over the brightest part of the wash sits on a different ground than text at the edge, so a surface that only just passes contrast at rest may not pass under the light at `@intensity` 0.5. Lower the intensity rather than the text's weight.
- **Reduced motion should stop the travel**, leaving the light at its resting origin — which is why `@restX` and `@restY` exist as args rather than being fixed at centre.

## Theming

`--pretui-spotlight-size` (from `@size`), `--pretui-spotlight-hue` (from `@hue`, defaulting to `--primary`), `--pretui-spotlight-strength` (from `@intensity`), `--pretui-spotlight-rest` (the floor), `--pretui-spotlight-radius` and `--pretui-spotlight-surface`, plus the shared pointer channel `--pretui-px` / `--pretui-py` this module's components all write.

Because the hue defaults to `--primary`, a season's accent lights every spotlight in the product without anyone restating it — and because the light composites against the surface rather than replacing it, a dark season gets a correct dark wash from the same token.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
