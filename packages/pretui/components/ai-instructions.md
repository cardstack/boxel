## What it is

The shelf of standing instructions given to an agent: an ordered list, each switchable and removable, with an add field and an optional cap.

## The contract

```
@instructions (required) — the instruction set, in the order it should read
@title?       — heading. Default 'Instructions'
@description? — one line under the heading
@onAdd?       — fires with the TRIMMED text of a new instruction
@onToggle?    — fires when an instruction is switched on or off
@onRemove?    — fires when an instruction is removed
@max?         — how many are allowed; shows a '3 of 10' counter and blocks the add
@placeholder? — for the add field
@emptyMessage? — what the empty shelf says
```

**Order is meaningful and the component preserves it.** Instructions read in sequence, so the list is not sorted, ranked or grouped — it is presented as given.

**`@max` shows a counter rather than only blocking.** "3 of 10" tells a reader where they stand before they hit the wall.

**Text arrives trimmed**, so the caller never stores an instruction with stray whitespace that changes nothing but looks like a different string.

**Switching off is not removing.** An instruction can be disabled and kept, which is the difference between "not now" and "never" — and the reason `@onToggle` and `@onRemove` are separate.

## Prior art

The custom-instructions surfaces in agent products.

Where Pretui is better: the enable/remove split and the visible cap. Most implementations offer only deletion, which makes experimenting with an instruction destructive.

Where it is thinner: no reordering — order matters and cannot be changed here — no per-instruction scope or condition, and no character budget beyond the count.

## Accessibility

- **The shelf is a named region**, and each instruction is a row with its own controls rather than a line of text with icons beside it.
- **Toggle and remove are separately named per instruction**, so a list of ten does not present twenty identical buttons.
- **The counter is text**, so proximity to the cap is perceivable rather than being conveyed by a disabled add button appearing.
- **`@emptyMessage` means an empty shelf says something** rather than being a blank panel.
- **Order is conveyed by list order**, which survives without sight — important, because order is semantically load-bearing here.

## Theming

The shelf takes the kit's block, list and control tokens; the switches are the kit's **Switch**.

Nothing is separately themeable, which keeps a settings-shaped surface looking like the rest of the application's settings.

The styles sit in `@layer PretComposite`, above Input's `PretComponent` layer, so what this component sets on Input wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
