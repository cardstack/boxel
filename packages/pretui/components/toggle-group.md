## What it is

A group of toggles where one — or many — can be pressed. **SegmentedControl**'s multi-select cousin, and the component for "left / centre / right, or none".

The line between this and **RadioGroup** is whether an empty selection is legal. "One of these must be true" is a radio group; "any of these, or none" is a toggle group.

## The contract

```
@options (required) — ToggleOption[]
@label (required)   — the group's accessible name
@multiple?          — switches the whole ARIA contract, not just the arithmetic
@value?, @defaultValue?, @onValueChange?    — single-select; null is an explicit empty
@values?, @defaultValues?, @onValuesChange? — multi-select; fires with the full next
                                              selection, in @options order
@orientation?       — arrow axis and visual flow. Default 'horizontal'
@deselectable?      — single-select only: re-activating the chosen option clears
                      the group. Default true
@tone?, @appearance?, @pressedAppearance?, @size? — the shared recipe axes
@iconOnly?          — every label becomes its item's sr-only name and title
@wrap?              — let a long horizontal group wrap rather than overflow
@disabled?          — dims and inerts the whole group

<:empty> — replaces the built-in "no options" line
```

**`@label` is required, not optional, and that is a deliberate departure.** The two internal components this replaced — a weekday row and a tag filter group — both shipped an unnamed pile of buttons. A group whose name is optional is a group that is usually unnamed.

**`@multiple` switches the ARIA contract.** Single-select is a `radiogroup` of `role='radio'` members; multi-select is a `toolbar` of pressed toggles. This is React Aria's split and it is the right one: **with one legal answer the arrows *are* the choice; with many they cannot be**, or a reader could never travel past an option without turning it on.

**`@deselectable` defaults to true**, which is what keeps a single-select toggle group from quietly becoming a radio group.

**Multi-select notifies with the full next selection in `@options` order**, not with a delta — so a caller never has to reconstruct the set.

## Prior art

**shadcn/Radix ToggleGroup**, **React Aria's ToggleButtonGroup**, **MUI's ToggleButtonGroup**.

Where Pretui is better: **the required name**, and the arrow-key contract switching with the selection model rather than being one behaviour for both. Most implementations use roving tabindex in both modes, which is wrong for single-select, or arrows-as-selection in both, which is wrong for multi.

Where it is thinner: no nested or grouped options, no overflow menu when a horizontal group runs out of room — `@wrap` is the only answer — and no per-option tone or disabled state; the axes apply to the whole group.

## Accessibility

- **The name is mandatory**, which is the fix this component exists to carry.
- **Single-select is a `radiogroup`**: arrows move *and* choose, one tab stop, the chosen member is the tab stop.
- **Multi-select is a `toolbar`**: arrows move without choosing, Space or Enter presses, one tab stop for the group. Travelling past an option must not activate it.
- **Members carry `aria-checked` in single mode and `aria-pressed` in multi**, which is why **Toggle** has an `@ariaState` arg at all.
- **`@iconOnly` gives every member an sr-only name and a title**, so a formatting bar is still navigable by name.
- **The pressed state is an appearance swap**, so it reads in greyscale — inherited from Toggle.
- **`@disabled` dims the whole group** and, like Toggle, keeps it announced rather than removing it.

## Theming

Tone, appearance, pressed appearance and size resolve through the kit's shared recipe system, exactly as **Toggle** does — the group sets them once and every member inherits, so a group cannot drift internally.

The consequence worth knowing: a season that changes what `accent` means changes every pressed member in every toggle group at once, and because the change is a recipe rather than a colour, it stays legible in greyscale wherever that season is applied.

The styles sit in `@layer PretComposite`, above Button's `PretComponent` layer, so what this component sets on Button wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
