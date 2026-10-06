## What it is

One button whose meaning is a **state**, not an action: pressed or unpressed.

It is deliberately neither of its neighbours. It is not a **Switch** — a setting that takes effect the moment it moves — and not a **Button**, which does a thing and returns to rest. Bold in a formatting bar is a Toggle. "Dark mode" is a Switch. "Save" is a Button.

## The contract

```
@pressed?, @defaultPressed?, @onPressedChange? — controlled / uncontrolled state
@onChange?         — alias; the HTML-shaped notify an agent reaches for
@ariaState?        — which ARIA attribute carries the state:
                     'pressed' (default) | 'checked' | 'none'
@label?            — accessible name; REQUIRED in @iconOnly mode
@iconOnly?         — draw the glyph only; @label becomes the sr-only name and the title
@tone?             — hue, default 'neutral'
@appearance?       — recipe worn at rest, default 'outlined'
@pressedAppearance? — recipe worn while pressed, default 'accent'
@size?             — scale, default 'm'
@disabled?, @isDisabled? — dims and inerts, but stays focusable and announced
@busy?, @loading?, @isPending? — pending: aria-busy, a spinner, clicks ignored, FOCUS RETAINED

<:default> — yields { pressed }, so a caller can swap the glyph in place
```

**The pressed state is an appearance swap, not a tint.** It changes recipe — outlined to accent — rather than shifting a colour, which is what makes it survive greyscale, a colour-blind reader, and a printout. This is the single most-copied mistake in toggle implementations.

**`@ariaState` exists because the same button means different things in different parents.** Standalone or in a toolbar it is `aria-pressed`; as a single-select **ToggleGroup** member beside `role='radio'` it must be `aria-checked`; `'none'` hands the ARIA to a parent that writes it.

**`@disabled` is `aria-disabled`, not the `disabled` attribute** — so the button stays focusable and announced, which is what a roving-tabindex toolbar requires. A natively disabled button vanishes from the tab order and a reader cannot discover it exists.

**`@busy` keeps focus.** A pending toggle is not a disabled toggle; disabling it on activation throws focus to the document.

**The block yields the resolved state** so a caller swaps the glyph in place rather than rendering two and hiding one.

## Prior art

**Radix/shadcn Toggle**, **React Aria's ToggleButton**, **MUI's ToggleButton**, **Tremor's Toggle**.

Where Pretui is better — three fixes over the Radix port: `aria-disabled` instead of `disabled` so it survives a toolbar; the pressed state as an appearance recipe rather than a tint so it reads in greyscale; and `@busy` as a real pending state that keeps focus rather than being modelled as a disable.

Where it is thinner: no indeterminate state, no long-press or hold behaviour, and no built-in tooltip for the icon-only mode — `@label` becomes the `title`, which is the browser's tooltip rather than the kit's.

## Accessibility

- **`aria-pressed` is the default and the right one** for a standalone toggle: it says "this control has a state" rather than "this control does a thing".
- **`@iconOnly` requires `@label`.** There is no text for a reader to fall back on, and an unnamed icon button is the most common accessibility defect in a formatting bar.
- **Disabled stays discoverable.** `aria-disabled` keeps the control in the tab order and in the accessibility tree, announced as unavailable rather than absent.
- **Busy is announced as busy** through `aria-busy`, and the spinner is `aria-hidden` so it is not read as content.
- **The state survives without colour.** The appearance swap changes border, fill and ink together, so pressed is perceivable in greyscale.
- **`@ariaState='none'` is a promise the parent has to keep.** Using it without a parent that writes the ARIA leaves a button with no state at all.

## Theming

The tone, appearance and size args resolve through the kit's shared recipe system rather than through component-local tokens, which is why a Toggle sits at exactly the same weight as a **Button** of the same size and tone beside it.

That shared resolution is the reason `@pressedAppearance` is an appearance name rather than a colour: a season defines what `accent` looks like once, and every pressed toggle in the product follows it — including in a season that expresses accent through border weight rather than fill.

The styles sit in `@layer PretComposite`, above Button's `PretComponent` layer, so what this component sets on Button wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
