## What it is

A form field whose value is a colour: a trigger showing the current colour, a popover holding a **ColorPicker**, and optional quick-pick swatches.

It is the form-facing wrapper. **ColorPicker** is the instrument; this is the field you put in a form.

## The contract

```
@label?, @description?, @required?, @disabled?
@value?, @defaultValue?
@path?      — path for form issue routing
@space?, @gamut?, @noAlpha?, @format? — forwarded to the picker
@presets?   — quick-pick swatches shown above the picker
@onValueChange?
```

**`@path` is what connects the field to a form's issue routing**, so a validation problem on this colour lands on this control rather than in a general error list.

**The picker's space, gamut, alpha and format args are forwarded**, so a field can lock the whole product to sRGB hex without the call site reaching past the field into the picker.

**`@presets` are a fast path, not a constraint.** They sit above the picker; the full picker remains.

## Prior art

**hdr-color-input.**

Where Pretui is better: the split between field and instrument. A colour picker embedded directly into a form is a large surface competing with the rest of the fields; putting it behind a trigger with a popover makes a colour field the same size as a text field, which is what a form wants.

Where it is thinner: no eyedropper on the trigger itself, no recent-colours memory across fields, and no contrast check against a paired colour — the obvious missing feature for a design-system colour field.

## Accessibility

- **The trigger carries `aria-haspopup='dialog'` and `aria-expanded`**, which is the correct pattern for a control that opens a picker rather than a listbox.
- **The trigger is named**, so a row of colour fields does not announce as several identical buttons.
- **The colour preview inside the trigger is `aria-hidden`** — the value is in the name, and a swatch has nothing to announce.
- **The popover holds ColorPicker**, so everything that component does about gamut reporting and text entry applies here.
- **`@description` is associated with the field**, giving a place for "hex or any CSS colour" that is not a placeholder.
- **A colour chosen by swatch is the same value as one typed**, so the two paths never disagree.

## Theming

`--pretui-swatch-size` and `--pretui-swatch-color` for the trigger and presets, `--pretui-palette-columns` for the preset grid, `--pretui-checker` behind anything with alpha, `--pretui-destructive-ink` for the invalid state, `--pretui-z-raised` for the popover layer.

`--pretui-palette-columns` as a token rather than an arg is deliberate: preset grids should have the same rhythm everywhere in a product, and a per-field column count is how a palette ends up looking different on two screens.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
