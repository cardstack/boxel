## What it is

An angle control: a circular dial paired with a numeric field, for rotation, direction and gradient angle.

## The contract

```
@value?, @defaultValue? — angle in DEGREES
@min?, @max?  — unbounded when omitted
@step?        — degrees per arrow press. Default 1
@snap?        — degrees the dial snaps to while Shift is held during a drag.
                Default 15; 0 disables
@unit?        — DISPLAY unit only; the value in and out is always degrees
@precision?   — decimal places in the paired field. Default 1
@showDial?    — render the circular dial. Default true
@showInput?   — render the paired numeric field. Default true
@rotations?   — show the ×N rotation badge, and fold it into aria-valuetext
@label?, @disabled?
@onInput?, @onChange? — degrees, continuously and on commit
```

**It is `@showInput` rather than the shorter name**, because the realm reserves DOM-event names for handlers — and a boolean called `input` reads wrong anyway.

**Unbounded means unbounded.** Without `@min`/`@max`, a value of 765 is two-and-a-bit turns and **stays that way** — it is not normalised to 45. That matters for anything where the number of turns is meaningful, and a dial that silently wrapped would destroy that information.

**`@unit` is display only.** Radians on screen, degrees on the wire, always — so a caller never has to know which unit a particular dial happens to be showing.

**Shift snaps during a drag**, to 15° by default. It does not snap arrow keys, which are already precise.

**Either half can be hidden.** A dial alone is compact; a field alone is exact; both is the default.

**`@rotations` surfaces the turn count** as a ×N badge and folds it into the announced value, which is what makes an unbounded angle legible rather than just large.

## Prior art

The angle control in design tools, figui3's included.

Where Pretui is better: not normalising. Most angle dials wrap at 360 because the circle does, which conflates "pointing right" with "turned twice and pointing right" — a real distinction in animation and in accumulated rotation.

Where it is thinner: no two-handle sweep, no compass-point presets, and no visual arc showing the difference from a previous value.

## Accessibility

- **The paired field is the exact-value path**, and it is the reason the dial can be a plain grip. `@showInput={{false}}` removes it, and should be used only where an approximate angle genuinely suffices.
- **Arrow keys move by `@step`** on the field, so precision is reachable without dragging.
- **The value is announced in degrees** regardless of `@unit`'s display choice, which keeps what a reader hears consistent across dials.
- **A circular drag has no keyboard equivalent**, which is exactly why the field is on by default rather than being an option.
- **Unbounded values are announced as they are** — 765, not 45 — and `@rotations` folds the turn count into `aria-valuetext`, so the turns are audible as well as visible.

## Theming

The dial and field take the kit's control tokens; the dial's grip is a **Handle**, so it inherits that component's shape and ring.

Sharing the handle is what keeps a dial's grip identical to a gradient stop's and a picking plane's — three controls, one object.
