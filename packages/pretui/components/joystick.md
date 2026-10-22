## What it is

A two-dimensional position pad: a grip you drag inside a square, with X/Y spinbuttons under it.

Use it for anything positioned in a box — a shadow offset, a focal point, a transform origin that is not on the nine-anchor grid. For those nine anchors, **OriginGrid** is the better shape.

## The contract

```
@value?, @defaultValue? — position as percentages, 0–100 on each axis
@coordinates? — 'screen' (default) puts 0,0 at the TOP left — the CSS frame.
                'math' puts 0,0 at the BOTTOM left, and ONLY the reported y changes
@step?        — percent moved by one arrow press. Default 1
@precision?   — decimal places in the paired fields. Default 0
@fields?      — render the X/Y spinbuttons under the pad. Default true
@axisLabels?  — four edge labels, in order: left, right, top, bottom
@origin?      — the position the reset control returns to. Default 50/50
@label?, @disabled?
@onInput?, @onChange? — continuously, and on commit
```

**`@coordinates` changes only the reported `y`.** The handle is drawn in screen space either way, so switching to `'math'` does not flip the pad — it flips the number, which is what a caller working in a mathematical frame actually wants.

**The X/Y fields are on by default, and they are the reason the pad can be a plain grip.** Exact values come from the fields; the pad is for the approximate gesture.

**`@axisLabels` name the four edges** — "cool/warm", "quiet/loud" — which is what turns an abstract square into a control someone can reason about.

**One arrow press moves `@step` percent**, Shift ten steps and Alt a tenth of one, so a step of 5 moves 5, 50 or 0.5.

## Prior art

The XY pad in design and audio tools.

Where Pretui is better: the paired fields as a default rather than an option, and the coordinate frame being a reporting choice rather than a rendering one.

Where it is thinner: no constraint to a shape other than the square, no snapping, and no multi-point mode.

## Accessibility

- **The pad's grip is a **Handle**, so it is a button** — focusable, activatable, nudgeable by arrow keys.
- **The X/Y spinbuttons are the exact path**, and turning them off leaves a control whose only precise input is a drag.
- **`@axisLabels` are announced**, which is what makes position meaningful: "70%, 30%" says little; "warm, quiet" says what was chosen.
- **`@origin` gives the reset a defined destination**, so returning to the default is one action rather than a careful drag.
- **Reset is announced as disabled** (`aria-disabled`) at the origin and while the Joystick is disabled, and does nothing then; it stays focusable either way.

## Theming

The pad takes the kit's surface and control tokens; the grip is a **Handle** and inherits its shape and ring.

Consistency with Handle is the point — a grip on a joystick, a gradient stop and a picking plane are the same object, and a reader who has learned one has learned all three.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
