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

<:default> — the buttons
```

**The three treatment axes are inherited through a custom-property channel**, not by cloning props onto children. A child **Button** reads them from the group, which is why an ordinary Button placed inside picks them up without the group needing to know what it contains.

**`@label` is strongly recommended rather than required**, and that is a real gap: an unnamed group of three buttons is announced as three loose buttons.

## Prior art

Web Awesome's button group, and the same component in every kit.

Where Pretui is better: the inheritance channel. Most implementations either clone props onto children — which breaks the moment a child is wrapped in anything — or require a special child component.

Where it is thinner: no split-button behaviour, no overflow, and no per-child override of the inherited axes short of setting them on the child directly.

**An open design tension, worth knowing:** the group restyles plain children rather than yielding a contextual `G.Button`. Yielding would make the contract explicit and let the group know its own membership; restyling keeps ordinary buttons usable inside it, including ones wrapped in something the group cannot see through.

## Accessibility

- **`role='group'` with `aria-orientation`**, so the arrangement is announced rather than only drawn.
- **`@label` is what makes the group meaningful.** Without it the role is announced with no name, which is close to no information.
- **Nothing here has a pressed state**, which is the semantic difference from **ToggleGroup** — and it is why there is no roving tabindex: every button is a separate action and a separate tab stop.
- **Shared edges are visual.** The grouping is conveyed by the role, not by the fact the buttons touch.

## Theming

`@tone`, `@appearance` and `@size` resolve through the kit's shared recipe system and reach children through custom properties.

That channel is the component's whole implementation: a season changes what `accent` means once, and every grouped button follows, including ones the group never knew about.
