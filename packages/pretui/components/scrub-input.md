## What it is

A number field you can drag: type into it, arrow it, click steppers, or scrub horizontally from a grip.

It is the design-tool number input, and it handles the case a plain number field cannot — a **stepped scale** whose legal values are not evenly spaced.

## The contract

```
@value?, @defaultValue? — null renders empty
@min?, @max?
@step?          — one arrow press, one stepper click, and @pixelsPerStep px of
                  horizontal scrub each move by this much. Default 1
@pixelsPerStep? — px of pointer travel that buys one step. Default 1
@steps?         — A STEPPED SCALE: the ordered list of legal values
@precision?     — decimal places kept on commit. Default 2
@unit?, @unitPosition? — 'px', '%', '°', 'ms'; prefix or suffix
@grip?          — short text shown in the grip when there is no unit
@scrubFrom?     — 'grip' (default) scrubs from the affix only; 'field' makes the
                  whole control a scrub surface; 'none'
@label?         — accessible name. REQUIRED in practice
@placeholder?
@steppers?      — show the up/down stepper pair
```

**`@steps` is the interesting arg.** Apertures, ISO speeds, type ramps and zoom levels are numeric without being continuous — the gaps between legal values are not uniform, so `@step` cannot describe them. Supply the ordered list and the control becomes a discrete spinbutton: scrub, arrows and steppers travel whole stops, `@min`/`@max` default to the ends of the list, a typed number snaps to the nearest legal value on commit, and the field shows the stop's label — `f/5.6` — while `aria-valuenow` still carries the number.

**`@pixelsPerStep` defaults to 1, and 6 is right for a stepped scale**, where one stop per pixel is unusable. Raise it for any control that needs a slower hand.

**`@scrubFrom='field'` still lets you select text**, because the field only scrubs while it is not focused.

**`@label` is required in practice**: a bare spinbutton in a panel of twenty is unusable without one.

## Prior art

**figui3's** number input and steppers.

Where Pretui is better: the stepped scale. Every design-tool number input assumes a uniform step, which means an aperture or ISO control has to be a select — losing the scrub — or a slider — losing the exact value. This is both.

Where it is thinner: no expression evaluation (`120/2`), no unit conversion on typing, and no multi-value scrub across a selection.

## Accessibility

- **It is a spinbutton with a name**, and the name is the arg the contract calls required.
- **On a stepped scale, `aria-valuenow` carries the number while the field shows the label.** A reader hears the value; a viewer sees the stop. Both are true, and neither is a translation of the other.
- **Arrows, steppers and scrub all move by the same `@step`**, so the three input methods agree — a control where dragging and arrowing disagree is disorienting for anyone switching between them.
- **Scrub is pointer-only by nature**, which is why arrows and steppers are not optional extras: they are the equal path.
- **`@steppers` adds visible controls** that are useful well beyond keyboard users — a precise single increment is hard to scrub.
- **Typed values snap on commit**, not on keystroke, so a reader can type through intermediate states.

## Theming

The control takes the kit's shared input and control tokens; the grip is a affix rather than a separate surface.

There is deliberately no scrub-specific palette — a scrub input in a property panel should be indistinguishable from the other fields until you drag it.
