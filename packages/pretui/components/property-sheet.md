## What it is

A property inspector built from a list of typed specs: rows, controls and values, assembled for you.

**PropertyRow** is one row; **ValueInput** is one control. This is the panel.

## The contract

```
@specs (required)  — the rows, in order
@values (required) — current values, keyed by spec.key
@layout?   — default row layout; each spec may override
@disabled?
@onChange? — fires with the key and the new value
@onReset?  — invoked by a row's reset control

<:custom> — receives [kind, value, spec] for kinds the sheet does not own
```

**A row shows a reset control only when the spec is `modified` *and* `@onReset` is supplied.** Both conditions, because a reset that cannot reset is worse than no reset, and a dot on an unmodified row is noise.

**Values are keyed rather than positional**, so reordering `@specs` cannot silently reassign values.

**`<:custom>` is the escape hatch for kinds ValueInput does not own** — colour above all — and it receives the kind alongside the value, so one block can handle several.

## Prior art

figui3's property sheets and the inspector panels in design tools.

Where Pretui is better: the sheet is data-driven from typed specs rather than hand-assembled, so a panel of thirty properties is a list rather than thirty blocks of markup — and every row gets the label association, hint wiring and mixed-state handling right because **PropertyRow** does it once.

Where it is thinner: no grouping or sections within a sheet, no collapsible categories, no search across properties, and no per-row validation.

## Accessibility

- **Every row's accessibility comes from PropertyRow**, so label association and hint description are correct by construction rather than per call site.
- **`@disabled` applies to the sheet**, and rows mark themselves accordingly.
- **Key-based values mean a row's label and its control always agree**, which is the failure mode of positional assembly.
- **`<:custom>` inherits the row's yielded ids**, so a caller-supplied control is wired the same way a built-in one is — and a caller who ignores them breaks the association silently.
- **A long sheet is a long list of form controls.** Grouping is the caller's to provide, and without it a thirty-property panel is thirty tab stops.

## Theming

Everything comes from **PropertyRow** and **ValueInput**; the sheet adds only stacking.

That is the right shape: a property panel's appearance is its rows' appearance, and a sheet with its own surface would fight whichever inspector chrome it was placed in.
