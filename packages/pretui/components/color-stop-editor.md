## What it is

The colour half of one gradient stop: a swatch trigger that opens a picker, a position, and a remove control.

It is **GradientEditor**'s unit. On its own it is the answer to "let someone edit one stop of something".

## The contract

```
@stop (required)   — the stop being edited
@selected?         — whether this is the stop currently in focus in its bar
@disabled?
@removable?        — whether to offer removal
@onSelect?         — fires with the stop's id
@onColorChange (required)    — fires with the id and the new colour
@onPositionChange (required) — fires with the id and the new position, or null
@onRemove?         — fires with the id
```

**Every callback carries the stop's id.** The editor never mutates the stop it was given; a parent holding a list of stops gets told which one changed and applies it. That is what makes the bar's state single-owned.

**`@onPositionChange` can report `null`**, which is how a stop says "no explicit position" rather than defaulting to zero — a distinction CSS itself makes.

**`@removable` gates the remove control.** A gradient needs two stops, so the last two should not offer removal, and that decision belongs to the parent that can count them.

## Prior art

A kit addition — the piece that lets a gradient bar be built from named controls rather than from a canvas of draggable dots.

Where it is thinner: no alpha handle separate from the colour, no per-stop easing hint, and no drag-to-reorder within this component — position changes come through the callback, and ordering is the parent's.

## Accessibility

- **The swatch trigger carries `aria-haspopup='dialog'` and `aria-expanded'`**, with a computed name, so a bar of stops announces as several distinguishable controls rather than as identical swatches.
- **The remove control is separately named**, including which stop it removes.
- **The swatch preview inside the trigger is `aria-hidden`** — the colour is in the name.
- **`@removable` being false removes the control rather than disabling it**, so a reader is not offered an affordance that will refuse.
- **Selection is reported, not assumed.** `@onSelect` lets a parent move a roving tab stop across a bar of stops, which is the arrangement that keeps a many-stop gradient to one tab stop.

## Theming

`--pretui-stop-color` (the stop's swatch) and `--pretui-stop-x` (its position along the bar), over `--pretui-swatch-size`, `--pretui-checker` and `--pretui-z-raised` for the popover.

Position being a custom property rather than an inline left offset is what lets the bar animate a stop's movement with a transition — the value changes, the paint follows, and no layout code runs.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
