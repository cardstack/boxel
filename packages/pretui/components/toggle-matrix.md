## What it is

A grid of switches: rows against columns, with every intersection independently on or off. The permissions matrix — roles against capabilities, people against projects.

## The contract

```
@rows, @columns (required)
@label (required)  — the grid's accessible name
@value?, @defaultValue? — every switched-on intersection
@onValueChange?    — fires with the whole next value, always in rows × columns order
@onToggle?         — fires once per cell that ACTUALLY changed, including inside a
                     bulk or span operation
@rowAxisLabel?     — name for the header of the row axis, e.g. 'Role'
@bulk?             — show the row / column / whole-matrix select-all checkboxes. Default true
```

**Two callbacks, two consumers.** `@onValueChange` hands you the whole next state, in a stable order, for storing. `@onToggle` fires once per cell that actually changed — including inside a bulk operation — so an **audit log gets individual grants rather than a diff**. That distinction is the reason both exist.

**`@label` is required**, for the same reason **ToggleGroup**'s is: a matrix of unnamed checkboxes is the worst case of the unnamed-group problem, because there are now two axes to be lost on.

**Bulk operations are per row, per column and whole-matrix.** A permissions grid without them is unusable at any real size.

## Prior art

A kit addition. The comparison is against the hand-rolled permissions table every product grows, and the two things those get wrong: no bulk selection, and a change event that reports the new state rather than the individual grants — which makes an audit trail impossible to reconstruct.

Where it is thinner: no tri-state or inherited-permission model, no row or column grouping, no virtualisation for a large matrix, and no per-cell disabled state — the grid is uniform.

## Accessibility

- **The grid is named, and both axes are labelled.** `@rowAxisLabel` names the row header column, which is the thing that is usually blank and leaves a reader unable to tell what the rows *are*.
- **A cell's meaning is the intersection of two headers**, which is why the axis labels matter more here than in a normal table — announcing "on" tells a reader nothing without both.
- **Bulk checkboxes are real controls**, so select-all-in-row is reachable rather than being a pointer-only convenience.
- **`@onToggle` firing per changed cell inside a bulk operation** means a caller can announce "4 permissions granted" accurately, rather than guessing from a diff.
- **The column rule aid is visual only.** A heavier rule every Nth column helps scanning and conveys nothing, which is correct.

## Theming

The matrix uses the kit's shared control and border tokens rather than a component-specific surface; the scanning rule is a border-weight change on the shared border token.

That sharing is what keeps a permissions grid looking like a table in the same product rather than like a spreadsheet embedded in it.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
