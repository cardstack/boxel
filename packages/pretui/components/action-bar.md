## What it is

The bulk-selection bar: "3 of 40 selected", the actions you can take against that selection, and a way to clear it.

## The contract

```
@count (required) — how many things are selected. ZERO HIDES THE BAR ENTIRELY
@total?    — the collection's size, for "3 of 40 selected"
@noun?     — singular noun, pluralised by adding an s. Default 'item'
@actions?  — the actions offered against the selection
@maxVisible? — how many actions get their own button before the rest collapse
             into an overflow Menu. Default 3
@overflowLabel? — default 'More actions'
@label?    — the bar's accessible name. Default 'Selection actions'
@clearLabel?    — default 'Clear selection'
@onClear?  — called by the clear button AND by Escape inside the bar
```

**Zero selection hides the bar.** The caller does not conditionally render it; it renders itself away, which is what keeps the show/hide logic in one place.

**Escape inside the bar clears the selection**, not just closes something — which is the shortcut people reach for and almost no implementation wires up.

**`@maxVisible` defaults to 3**, and everything past it folds into a Menu rather than wrapping or scrolling.

## Prior art

The bulk-action bar in table and list UIs.

Where Pretui is better: Escape clearing, the self-hiding at zero, and the count sentence being built from `@count`/`@total`/`@noun` rather than assembled at each call site — which is how "1 items selected" ships.

Where it is thinner: no undo affordance after a bulk action, no per-action confirmation, and no partial-selection state ("all on this page").

## Accessibility

- **The bar is a named region**, so it is findable when it appears.
- **The count is a sentence**, not a number beside an icon — "3 of 40 items selected" is what gets announced.
- **Escape clearing is a keyboard affordance for the most common intent**, and it is wired to the same handler as the button so the two can never diverge.
- **The overflow trigger is named** rather than being an unlabelled ellipsis.
- **A bar appearing is a change worth noticing.** Whether it is announced is the host's call — the component supplies a region, not a live region.

## Theming

The bar takes the kit's surface, elevation and control tokens.

It usually floats over content, so it uses the shared raised elevation — the same one every other floating surface uses, which is what stops a selection bar looking like a different application's toolbar.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
