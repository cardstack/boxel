## What it is

One labelled row of a property inspector: a label column, a control, a hint, a mixed-state marker and a reset affordance.

**PropertySheet** builds a panel out of these. Use the row directly when the panel is hand-assembled.

## The contract

```
@label?      — the property name, shown in the label column
@hint?       — short explanation under the control, referenced by aria-describedby
@layout?     — 'row' (default) puts the label in a fixed left column — the dense
               inspector shape. 'stack' puts it above. 'split' gives equal halves
@labelWidth? — width of the label column in 'row' layout; any CSS length
@mixed?      — the selection holds more than one value for this property
@modified?   — the value differs from its default: reveals the reset control
@onReset?    — invoked by the reset control
@disabled?   — dims the row, blocks reset, and is yielded to the control

<:default> — the control(s). Yields [controlId, hintId, disabled]
<:label>   — replaces the plain text label, for a label that is itself a control
<:actions> — trailing affordances: a link/unlink toggle, an overflow menu
```

**`@mixed` renders the word "Mixed"**, never a colour or a bare dash. State is never colour alone, and a multi-selection whose values differ is exactly the state that gets shown as an empty field in hand-built inspectors — which reads as "no value" and is a lie.

**The row yields both ids the caller needs**: the one to put on the control so the label points at it, and the hint's id for `aria-describedby`. That is what makes the label association correct without the caller minting ids.

**Without `@onReset` the modified dot is informational only.** The affordance appears when there is something for it to do.

**`@disabled` dims the row (`data-disabled`) and blocks the reset control, which stays focusable with `aria-disabled`.** The row cannot reach into a yielded block, so it yields the state as the third block param: pass it to the control's own `@disabled`.

## Prior art

figui3's property rows, and the inspector rows in every design tool.

Where Pretui is better: the yielded ids, and "Mixed" as a word. Both are small; both are the things hand-built inspectors get wrong most reliably.

Where it is thinner: no inline validation state, no per-row units switching (that is `<:label>`'s job), and no drag-to-reorder.

## Accessibility

- **The label points at the control through a yielded id**, so the association is real rather than positional — which is the whole point of the block yielding rather than wrapping.
- **The hint is referenced by `aria-describedby`**, not left as adjacent text.
- **"Mixed" is a word**, so a multi-value selection is perceivable without sight and without interpreting an empty field.
- **`<:label>` exists for a label that is itself a control** — a scrub grip, a units toggle — which is the case where a plain `<label>` would be wrong.
- **The disabled state belongs to the controls.** The row is a layout box, not a widget, so it carries `data-disabled` for styling only. The reset button gets `aria-disabled`, and the yielded `disabled` lets the control announce its own state.

## Theming

`@labelWidth` is a caller value rather than a token, because inspector density is a property of the panel rather than the season; everything else takes the kit's shared control and text tokens.

The three layouts exist so one component serves a dense left-column inspector, a stacked mobile form and an equal-halves settings row without any of them inventing their own row.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
