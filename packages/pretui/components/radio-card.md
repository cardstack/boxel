## What it is

One-of-N where every option is a card. The card is the label and the whole hit target; a real radio sits inside it, visually hidden, and a small mark in the card's corner shows the state. Use it when each option needs a title, a line of description and a figure — a billing plan, a shipping speed, a region — and the choice deserves the room. If the options are short words, **RadioGroup** is the same contract at a fraction of the size. If the options are peers that switch a view rather than set a value, **SegmentedControl**. If more than one option can be chosen, **CheckboxCard** is this component with an array value. If the card is content rather than a choice, **Card**.

## The contract

```
@options?          — ChoiceCardOption[]: { value, title, description?, meta?, disabled? }
@items?            — alias of @options
@value?            — controlled selection; omit for the uncontrolled half
@defaultValue?     — uncontrolled seed
@onValueChange?    — fires with the chosen value; @onChange is the alias
@disabled?         — every card; @isDisabled is the alias
@label?            — the radiogroup's accessible name when no label element points at it
@name?             — the form field the radios submit under; a generated name groups them otherwise
@orientation?      — 'vertical' (default) | 'horizontal'
@columns?          — 2 | 3 | 4, a fixed count for 'horizontal'
<:default as |option selected|>   — replaces the generated title and description
<:media as |option|>              — an icon or thumbnail on the card's start edge
```

**Hybrid state.** With `@value` undefined the group keeps its own selection, seeded by `@defaultValue`. With `@value` set the group never moves itself: it reports the request through `@onValueChange`, puts the native radios back to the controlled value, and waits for the parent to change the arg. So the checked input always matches the painted card, and a withheld card can be requested again. The callback fires in both modes.

**`@name` makes it a form field.** A `<form>` around the group submits the chosen value under `@name`. Without it the radios share a generated name, which groups them for the keyboard but submits under a meaningless key.

**One option is disabled through `disabled` on the option; the group through `@disabled`.** Either disables the real radio, so the platform skips it, and stamps `data-disabled` on the card.

**Selection is a hairline, not a border.** The chosen card wears a 1px ring in `--primary` and a soft 4px halo of the same hue at 12%; the rest of the card does not change. The corner mark is the same 15px disc **RadioGroup** draws, so a card group and a plain group read as one family.

**State attributes are strings both ways.** `data-selected='true' | 'false'` and `data-disabled='true' | 'false'` on every card; `data-orientation` and `data-columns` on the root.

## Prior art

**Chakra `RadioCard`** is a root with `RadioCard.Item`, `ItemText`, `ItemDescription`, `ItemIndicator` and an `ItemHiddenInput`, with `variant` (`surface` / `subtle` / `outline` / `solid`) and `orientation`; the addon slot is a separate `ItemAddon` band. **Tremor `RadioCardGroup`** is the same idea over Radix `RadioGroup`, a plain card per item and a `RadioCardIndicator` you place yourself. The **origin-ui** recipes hand-roll the pattern from shadcn `RadioGroup` plus a `Label` styled with `has-[[data-state=checked]]`.

Where this is better: **it is a single component, not an assembly.** An option is a value, a title, a description and a figure, and the card is generated from that; the hidden input, the indicator and the selected ring do not have to be composed by hand each time, which is where the recipes go wrong (an indicator outside the label, a card that is not the hit target). The keyboard model is the platform's because the inputs are real radios sharing a name, not a Radix roving-tabindex reimplementation.

Where it is thinner: **one visual recipe.** There is no `variant` axis — no filled or solid card — and no per-card tone. The **media** slot is a start-edge slot only; there is no addon band under the body. The card's title and description are strings unless you take over the whole body with the default block. There is no `size` axis.

## Accessibility

Governing pattern: a native radio group. The root is `role="radiogroup"` and takes `@label` as `aria-label`; each card is a `<label>` wrapping a real `<input type="radio">`, and every radio in the group shares one generated `name`.

What that buys, without any script: **the platform keyboard model.** Tab lands on the checked radio (or the first, when none is checked), arrow keys move the selection between cards and check as they go, and the roving tabindex is the browser's. Clicking anywhere on the card is a click on its label, which checks the radio.

- **Focus stays visible.** The input is positioned off the card at 1px with zero opacity — it is in the tab order and in the accessibility tree — and the card paints the focus ring itself through `:has(.pretui-optioncard-input:focus-visible)`.
- **The accessible name of each radio is the card's text**: title, description and meta, in that order, because all of it is inside the label. A long description makes a long announcement; that is the caller's to keep short.
- **The mark is `aria-hidden`.** It repeats the checked state visually and contributes nothing to the tree.
- **`data-selected` is a stamp, not a role.** Assistive tech reads the radio's own checked state.
- **A media block's content is inside the label**, so an icon with a text alternative becomes part of the radio's name. Pass `aria-hidden` on decorative icons.

The tests assert the radiogroup role, the shared name, one radio per label, the click-to-check path, disabled propagation and the data stamps. Arrow-key movement is the platform's and is not re-asserted.

## Theming

From the host theme: `--card` and `--card-foreground` (the card surface and its ink), `--border` (the resting hairline), `--hover` (the hover fill), `--primary` (the selected ring, halo and mark fill), `--primary-foreground` (unused on a radio mark; the checkbox check), `--field` and `--input` (the resting mark), `--ring` (the focus outline), `--muted-foreground` (description and meta).

Kit tokens, each named once on the card: `--space-4` (padding), `--space-3` (gap), `--text-ui-md` and `--text-ui-sm` (title and description), `--weight-strong` (title weight), `--radius-surface` (card radius), `--pretui-dur-snap` and `--pretui-ease-snap` (the ring and fill transitions), `--pretui-shadow-control` (the resting shadow), `--pretui-edge-highlight` (the inset highlight on a selected mark). The grid reads `--space-3` for its gap.

A season retunes the selected treatment entirely through `--primary`; the 12% halo mix, the 15px mark and the 11rem minimum card width in `horizontal` are fixed.

## React ecosystem

| React | Pretui |
| --- | --- |
| value / onChange | `@value` / `@onValueChange` (`@onChange` accepted) |
| defaultValue | `@defaultValue` |
| items | `@items` (alias of `@options`) |
| orientation | `@orientation` |
| disabled / isDisabled | `@disabled` / `@isDisabled` |
| RadioCard.Item children | the default block, yielded the option |
| ItemAddon / indicator | not separate — `meta` on the option and the corner mark |
