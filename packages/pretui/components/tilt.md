## What it is

A perspective tilt tracking the hover position, over a real card surface.

Stated plainly, because the kit's own rules name this component as the canonical cut: **an idle tilt encodes nothing.** It is decoration. It ships because five reference kits converged on it, and it earns its place on exactly two grounds, both of which are real in a still frame.

## The contract

```
@max?         — maximum rotation in degrees at the corners. Default 8
@reverse?     — invert the rotation, so the surface leans away from the pointer
@perspective? — perspective depth in px; larger is flatter. Default 900
@glare?       — the moving specular sheen. Default true
@plate?       — give the tilted thing a real card surface. Default true
@press?       — tip toward and sink at the press point. Default true

<:default> — the tilted content
```

**`@plate` is the first reason to keep it.** It makes the tilted thing an actual kit surface — card radius, `--pretui-shadow-card` at rest lifting to `--pretui-shadow-raised` on engage — so a screenshot shows an elevated card with the tilt as garnish rather than a rectangle that does nothing.

**`@press` is the second, and it is the only part of Tilt that encodes anything.** It tips the plate toward the *actual* press point and sinks it, which is a real state transition: pressed, and here. If you keep one behaviour, keep this one.

**The default max is 8 degrees, not 15.** Upstream's 15 reads as a toy.

## Prior art

**motion-primitives' Tilt**, with four other kits shipping the same idea.

Where Pretui is better: the resting state is a real surface rather than nothing, the press encodes the press *location*, and the rotation is dialled back to something that reads as material rather than as a gimmick.

Where it is thinner: no spring or momentum on the return, no gyroscope input on touch, no per-axis maximum, and no scale-on-hover. Upstream offers a spring config; here the motion is a transition.

**The honest summary:** with `@plate={{false}}` and `@press={{false}}`, this component is pure decoration with no still-frame presence, and the kit's own rules would say not to ship it. The defaults exist to keep that from happening by accident.

## Accessibility

- **The glare is `aria-hidden`.** It is a specular highlight, not content.
- **The tilt adds no interaction and no keyboard surface.** Whatever is inside keeps its own; a keyboard user gets the plate and none of the motion, which is why `@plate` matters more than the tilt itself.
- **Reduced motion should hold the plate flat.** The resting state is a card, so stopping the motion leaves a correct, complete surface rather than a frozen angle.
- **Nothing is conveyed by the tilt.** Except the press, which is a genuine affordance — and a press that is also announced by whatever control is inside.
- **Perspective transforms can affect text rendering.** Body copy inside a tilting plate is rasterised at an angle while it moves; keep long text out of one.

## Theming

`--pretui-tilt-max` (from `@max`), `--pretui-tilt-perspective` (from `@perspective`), `--pretui-tilt-sign` (from `@reverse`), `--pretui-tilt-radius` and `--pretui-tilt-surface` (the plate), plus `--pretui-shadow-card` at rest and `--pretui-shadow-raised` on engage.

Using the kit's two shared shadow tokens rather than bespoke ones is what makes a tilting card lift to exactly the elevation every other card in the season lifts to. A season that flattens its elevation scale flattens this with it, and the tilt keeps working at whatever depth that leaves.
