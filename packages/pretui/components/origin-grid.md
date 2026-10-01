## What it is

The nine-anchor origin picker: a 3×3 grid of transform-origin anchors, with optional freeform positioning between them.

**Joystick** is the free two-dimensional pad. This is the one for the nine positions a transform origin usually is.

## The contract

```
@value?, @defaultValue? — anchor as percentages, 0–100. Defaults to the centre
@freeform?  — allow free positions between the anchors by dragging. Default true
@fields?    — render the X/Y spinbuttons. Default FALSE — most panels only need
              the nine anchors
@precision? — decimal places in the fields. Default 0
@label?, @disabled?
@onChange?
```

**`@fields` defaults to false here and true on Joystick**, and the difference is the point: nine anchors are nine buttons, which is already an exact path. A free pad has none, so it needs the spinbuttons.

**It is `@freeform` rather than being named after the gesture** — the realm's `no-passed-in-event-handlers` rule reserves DOM-event names, so a boolean cannot carry one.

**The value is percentages either way**, so an anchor and a freeform position are the same shape of value and a caller never branches on which was used.

## Prior art

The transform-origin picker in design tools.

Where Pretui is better: the nine anchors are real buttons rather than regions of a canvas, so the common case — picking a corner — is a keyboard action rather than a careful drag.

Where it is thinner: no visual preview of what the origin does to the object, no per-axis constraint, and no named anchors in the value (it is always percentages, never `'top left'`).

## Accessibility

- **Nine anchors, nine buttons.** This is the whole accessibility argument: the case people actually use is reachable by tab and arrow rather than by pointer precision.
- **Freeform dragging is an enhancement over that**, not the primary path — which is the right way round, and the opposite of most implementations.
- **`@fields` exists for the freeform case**, and should be turned on whenever `@freeform` matters to the design.
- **The current anchor is announced as a selected state**, not conveyed by a filled dot alone.
- **`@label` names the grid**, so it does not present as nine unexplained buttons.

## Theming

The grid takes the kit's control and ring tokens; the freeform handle is a **Handle**.

There is no origin-specific palette — the anchors are small buttons and should look like the kit's small buttons, because that is what tells a reader they can be pressed.
