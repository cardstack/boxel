## What it is

One control chosen by kind: hand it a `kind` and a value and it renders the right editor.

It is the switch **PropertySheet** uses to turn a typed spec into a control, and the reason a property panel is a list of data rather than a tree of conditionals.

## The contract

```
@kind (required) — which control to render
@value?      — the value, in whatever shape the kind implies
@spec?       — knobs for the chosen kind; unrelated fields are simply unread
@controlId?  — id to put on the control, so a PropertyRow label points at it
@describedBy?
@disabled?
@onChange?

<:custom> — kinds this component does not own — colour above all.
            Receives the kind and the raw value
```

**`@spec` is a partial bag and unrelated fields are unread.** That is what lets one spec type describe every kind: a numeric row's `min`/`max` and a select row's `options` can live in the same object, and each kind takes what it needs.

**`@controlId` and `@describedBy` are passed through to the control**, which is how the row's label association survives the indirection.

**`<:custom>` is where the boundary is drawn**, and colour is the named case: a colour editor is a component in its own right, and inlining one here would make this switch own a picker.

## Prior art

The value-editor switch inside every property panel implementation.

Where Pretui is better: it is a component with a contract rather than a conditional inside a sheet, which means a caller assembling rows by hand gets the same behaviour the sheet gets. The custom block makes the boundary explicit instead of the switch quietly growing.

Where it is thinner: the kind list is fixed — extending it means `<:custom>` — there is no validation, and no kind inference from the value's shape.

## Accessibility

- **The ids pass through.** A control rendered here is labelled and described by whatever row contains it, exactly as a hand-written control would be.
- **`<:custom>` receives no ids of its own beyond what the caller wires**, so a custom control that ignores `@controlId` breaks its label association — the one way to get this wrong.
- **Each kind renders a real control of its type** rather than a styled div, so the platform's semantics come along.
- **`@disabled` is passed to the control**, not applied as a visual state on a wrapper.

## Theming

Nothing of its own — every kind renders a kit control and inherits that control's tokens.

A switch that themed would be a switch that made a text field in a property panel look different from a text field in a form, which is exactly the drift this component exists to prevent.
