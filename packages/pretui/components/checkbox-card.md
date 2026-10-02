## What it is

Many-of-N where every option is a card. The card is the label and the whole hit target; a real checkbox sits inside it, visually hidden, and a small square mark in the card's corner shows the state. The value is the array of chosen values. Use it when each option carries a title, a description and a figure and several can be on at once — add-ons, notification channels, export targets. If the options are short words, a column of **Checkbox** is the same contract at a fraction of the size. If exactly one can be chosen, **RadioCard** is this component with a string value. If the card is content rather than a choice, **Card**.

## The contract

```
@options?          — ChoiceCardOption[]: { value, title, description?, meta?, disabled? }
@items?            — alias of @options
@value?            — controlled selection, readonly string[]; omit for the uncontrolled half
@defaultValue?     — uncontrolled seed
@onValueChange?    — fires with the whole array after the toggle; @onChange is the alias
@disabled?         — every card; @isDisabled is the alias
@label?            — the group's accessible name when no label element points at it
@name?             — the form field every checked box submits under
@orientation?      — 'vertical' (default) | 'horizontal'
@columns?          — 2 | 3 | 4, a fixed count for 'horizontal'
<:default as |option selected|>   — replaces the generated title and description
<:media as |option|>              — an icon or thumbnail on the card's start edge
```

**Hybrid state, array out.** With `@value` undefined the group keeps its own array, seeded by `@defaultValue`. With `@value` set the group never moves itself: it reports the toggled array through `@onValueChange` and waits for the parent to change the arg. The callback always receives a new array — the chosen values in the order they were chosen, minus the one toggled off — never a mutated one. A withheld toggle is undone on the native checkbox, so the checked input always matches the painted card.

**`@name` makes it a form field.** A `<form>` around the group submits each checked value under `@name`, the usual repeated-key shape. Without it the checkboxes submit nothing.

**One option is disabled through `disabled` on the option; the group through `@disabled`.** Either disables the real checkbox and stamps `data-disabled` on the card.

**Selection is a hairline, not a border.** Each chosen card wears a 1px ring in `--primary` and a soft 4px halo of the same hue at 12%. The corner mark is the same 15px rounded square **Checkbox** draws, with the same clip-path tick, so a card group and a plain checkbox read as one family.

**State attributes are strings both ways.** `data-selected='true' | 'false'` and `data-disabled='true' | 'false'` on every card; `data-orientation` and `data-columns` on the root.

## Prior art

**Chakra `CheckboxCard`** is a per-item component — `CheckboxCard.Root`, `Control`, `Label`, `Description`, `Indicator`, `Addon` and a `HiddenInput` — with `variant` and `size` axes; grouping is the caller's, usually a `CheckboxGroup` around several roots. The **origin-ui** recipes build it from shadcn `Checkbox` inside a styled `Label` with a `has-[[data-state=checked]]` ring.

Where this is better: **the group is the component.** The array value, the toggling and the generated card come together, so the pattern cannot be assembled wrong — the checkbox is always inside its label, the indicator is always tied to the real input, and the value is one array rather than N booleans to fold. Nothing is reimplemented: Space toggles because the input is a checkbox.

Where it is thinner: **one visual recipe, group-level only.** There is no per-card `variant` or `size`, no addon band under the body, and no way to address a single card as its own component — a lone CheckboxCard is a one-element group. Title and description are strings unless the default block takes over the body. There is no indeterminate state; that belongs to a parent **Checkbox** driving this group.

## Accessibility

Governing pattern: a group of native checkboxes. The root is `role="group"` and takes `@label` as `aria-label`; each card is a `<label>` wrapping a real `<input type="checkbox">`. The checkboxes are independent controls; `@name` is what gives them a form field.

What that buys, without any script: **the platform keyboard model.** Every checkbox is its own tab stop, Space toggles the focused one, and clicking anywhere on the card is a click on its label.

- **Focus stays visible.** The input is positioned off the card at 1px with zero opacity — in the tab order and in the accessibility tree — and the card paints the focus ring through `:has(.pretui-optioncard-input:focus-visible)`.
- **The accessible name of each checkbox is the card's text**: title, description and meta, because all of it is inside the label. Keep the description short or the announcement is long.
- **The mark is `aria-hidden`.** It repeats the checked state visually and contributes nothing to the tree.
- **`data-selected` is a stamp, not a role.** Assistive tech reads the checkbox's own checked state.
- **A media block's content is inside the label**, so an icon with a text alternative becomes part of the checkbox's name. Pass `aria-hidden` on decorative icons.
- **One tab stop per card** is the cost of independent checkboxes; a long list is a long Tab sequence. That is correct for a many-of-N choice and is what every checkbox group does.

The tests assert the group role, one checkbox per label, the click-to-toggle path and the array it reports, disabled propagation and the data stamps.

## Theming

From the host theme: `--card` and `--card-foreground` (the card surface and its ink), `--border` (the resting hairline), `--hover` (the hover fill), `--primary` (the selected ring, halo and mark fill), `--primary-foreground` (the tick), `--field` and `--input` (the resting mark), `--ring` (the focus outline), `--muted-foreground` (description and meta).

Kit tokens, each named once on the card: `--space-4` (padding), `--space-3` (gap), `--text-ui-md` and `--text-ui-sm` (title and description), `--weight-strong` (title weight), `--radius-surface` (card radius), `--pretui-dur-snap` and `--pretui-ease-snap` (the ring and fill transitions), `--pretui-shadow-control` (the resting shadow), `--pretui-edge-highlight` (the inset highlight on a selected mark). The grid reads `--space-3` for its gap.

A season retunes the selected treatment entirely through `--primary`; the 12% halo mix, the 15px mark and the 11rem minimum card width in `horizontal` are fixed.

## React ecosystem

| React | Pretui |
| --- | --- |
| value / onChange (`string[]`) | `@value` / `@onValueChange` (`@onChange` accepted) |
| defaultValue | `@defaultValue` |
| items | `@items` (alias of `@options`) |
| orientation | `@orientation` |
| disabled / isDisabled | `@disabled` / `@isDisabled` |
| CheckboxCard.Label / Description | `title` / `description` on the option, or the default block |
| Addon / Indicator | not separate — `meta` on the option and the corner mark |
