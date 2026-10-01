## What it is

A free-text input over a filtering listbox: type to narrow a known list, then choose from it.

The difference from **Autocomplete** is what counts as a value. A combobox's value is constrained to its list; an autocomplete's value is whatever the reader typed, with the list as help. If free text is a legal answer, you want the other one.

## The contract

```
@options (required) — the full candidate list; filtering is local
@value?, @defaultValue? — controlled / uncontrolled
@placeholder?
@label?          — accessible name for the combobox input
@disabled?       — blocks every interaction
@invalid?        — error dress plus aria-invalid
@onSearch?       — emitted on every keystroke with the current search text
@onValueChange?  — emitted with the chosen value, or '' when cleared
@onOpenChange?   — emitted when the dropdown opens or closes

<:option> — replaces the default row; yields the option and { term }
```

**Filtering is local and there is no fetching here.** `@options` is the full candidate list and the component narrows it; `@onSearch` exists so a caller can react to the query, not so the component can wait for one.

**Clearing reports `''`, not null.** One empty representation, matching the kit's convention that a control's value is a string.

**The option block receives the live term**, so a custom row can highlight the match without re-deriving it.

## Prior art

**React Spectrum's Combobox.**

Where Pretui is better: the explicit split from Autocomplete. Most kits ship one component with a `freeSolo` or `allowsCustomValue` flag, which means the value's *type* changes with a boolean — a caller has to handle both shapes everywhere. Two components with two contracts is the clearer answer.

Where it is thinner: no async loading, no grouped or sectioned options, no multi-select, and no virtualisation — a very long option list renders in full. There is also no "create this" affordance, which is what a `freeSolo` flag usually buys.

## Accessibility

- **The input is the combobox** and carries `aria-invalid` when `@invalid`, so the error state is announced rather than only dressed.
- **`@label` names the input.** Without a wrapper supplying a label, an unnamed combobox is announced as an unlabelled text field with a popup.
- **`<:option>` is rendered into a row whose accessible name is computed**, so custom markup in the block cannot corrupt what the option announces.
- **Open and close are reported through `@onOpenChange`**, which a caller needs if it is coordinating with anything else on screen — two popovers open at once is a focus problem.
- **Local filtering means the list is complete and stable**, so a reader arrowing through options is not racing a fetch.

## Theming

`--pretui-combobox-max-height` and `--pretui-lookup-max-height` bound the dropdown, over the kit's shared overlay tokens — `--pretui-shadow-overlay` for the layer, `--pretui-shadow-control` and `--pretui-shadow-inset` for the field, `--pretui-destructive-ink` for the invalid state, and `--pretui-dur-snap` / `--pretui-ease-snap` for the open transition.

Two max-height tokens rather than one lets a season bound a combobox and a lookup differently — a combobox over twelve options and a lookup over a thousand want different ceilings, and collapsing them forces one to be wrong.

The rules for the combobox's own elements sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector. The `:deep()` rules that restyle BoxelMultiSelect's power-select markup stay unlayered, because its own rules are unlayered and would beat them from inside a layer.
