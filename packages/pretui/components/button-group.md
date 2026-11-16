## What it is

A row or column of buttons treated as one object: shared edges, shared tone, shared size.

It is not a **ToggleGroup** — nothing here has a pressed state. These are actions that happen to sit together.

## The contract

```
@label?       — group label for assistive tech; strongly recommended
@orientation? — 'horizontal' | 'vertical'
@tone?        — inherited by every child Button
@appearance?  — recipe applied to every child Button
@size?        — font-size scale applied to every child Button
@shape?       — outer-corner treatment; inner corners stay square
@separator?   — word drawn as "— or —" between two equal paths

<:default> — the buttons
```

**The three treatment axes are inherited through a custom-property channel**, not by cloning props onto children. A child **Button** reads them from the group, which is why an ordinary Button placed inside picks them up without the group needing to know what it contains.

**`@label` is strongly recommended rather than required**, and that is a real gap: an unnamed group of three buttons is announced as three loose buttons.

**A horizontal group stacks all at once when its row doesn't fit.** The row is measured against the parent's content width, and the moment it is wider every button takes its own line: never two and one. The group lands `data-fold='row'` or `'stack'`, and a stacked group fuses vertically like `@orientation='vertical'`. It is measured, not a breakpoint, because a breakpoint can't know the labels or `@size`, and a container query would collapse an auto-sized parent. A vertical group never folds.

**`@separator` turns a fused group into two equal paths.** The buttons are spaced instead of sharing an edge, and the word sits between the first button and the rest with a short rule on each side, in a row or a stack. It is drawn by the group, so callers still pass plain Buttons. Use it for two alternatives of equal weight, such as an empty state's "Go to checkout" or "Back to the shop". The word is punctuation: it stays out of the accessible name, and the group's `@label` names the choice.

## Prior art

Web Awesome's button group, and the same component in every kit.

Where Pretui is better: the inheritance channel. Most implementations either clone props onto children — which breaks the moment a child is wrapped in anything — or require a special child component.

React Aria and Radix leave stacking to the caller's CSS. Polaris `ButtonGroup` and Atlassian `ButtonGroup` wrap the buttons, which can leave one button on its own line; this group stacks them all at once instead. shadcn `Empty` and Polaris/Atlassian `EmptyState` put their actions in one slot and leave the layout to a button group, which is how EmptyState uses this one.

Where it is thinner: no split-button behaviour, no overflow menu, and no per-child override of the inherited axes short of setting them on the child directly.

**An open design tension, worth knowing:** the group restyles plain children rather than yielding a contextual `G.Button`. Yielding would make the contract explicit and let the group know its own membership; restyling keeps ordinary buttons usable inside it, including ones wrapped in something the group cannot see through.

## Accessibility

- **`role='group'` with `aria-orientation`**, so the arrangement is announced rather than only drawn.
- **`@label` is what makes the group meaningful.** Without it the role is announced with no name, which is close to no information.
- **Nothing here has a pressed state**, which is the semantic difference from **ToggleGroup** — and it is why there is no roving tabindex: every button is a separate action and a separate tab stop.
- **Shared edges are visual.** The grouping is conveyed by the role, not by the fact the buttons touch.

## Theming

`@tone`, `@appearance` and `@size` resolve through the kit's shared recipe system and reach children through custom properties.

That channel is the component's whole implementation: a theme changes what `accent` means once, and every grouped button follows, including ones the group never knew about.

The styles sit in `@layer PretComposite`, above Button's `PretComponent` layer, so what this component sets on Button wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
