## What it is

A **named status dot on the corner of another element**: online, live, unread, syncing. It wraps the element and puts a small dot on one corner, with an optional pulse for something live.

Reach for a neighbour when the mark is something else:

- **Badge** is a count, a number on the corner.
- **Presence** is a person's full availability state with its label.
- **StatusChip** is an inline status in the text.

## The contract

```
@label (required), @tone? (default 'success')
@ping?, @placement? ('top-end' | 'top-start' | 'bottom-end' | 'bottom-start'; default 'top-end')
@circular?, @invisible?
<:default>   — the element the dot sits on
Element: HTMLSpanElement
```

**`@label` is required.** The dot is decoration and `aria-hidden`, and the label is its meaning. It is a visually hidden run after the child, so "Ana Ruiz, Online" reads in order. When the child is focusable, such as an avatar button, it points at the label with `aria-describedby`, so focus reads it too. Colour and the ping are never the only signal (Law 6).

**`@ping` pulses a ring** around the dot for something live. Under `prefers-reduced-motion` the ring is removed and the solid dot stays.

**Placement is logical** and the physical spellings map. `@circular` pulls the dot in toward a round child such as an **Avatar**. `@invisible` removes the dot and its label together, so nothing is announced for a dot that isn't shown.

## Prior art

**Mantine `Indicator`** takes `color`, `position`, `offset`, `processing` (the pulse), `withBorder`, `disabled` and an optional `label` that is painted, not spoken. **MUI `Badge variant="dot"`** and **Ant `Badge dot`** are the same idea on their badge. None of them has an accessible name.

Where Pretui is better: **the dot means something to everyone**, because `@label` is required and spoken. **The pulse respects reduced motion.** Mantine's `processing` animation runs regardless.

Where it is thinner: **no `offset`**, and **no painted label** inside the dot. Use **Badge** for a number.

## Accessibility

No APG pattern.

- **The dot is `aria-hidden`; the label is spoken after the child.** A focusable child is described by it. The tests assert both, the reading order "Ana Ruiz Online", and the description wiring.
- **`@invisible` removes both**, which the tests assert.
- **Changes are not announced.** Someone going offline while the user reads the page is not a live region. Announce it separately if it matters now.
- **Motion.** The ping is removed under `prefers-reduced-motion`, leaving the solid dot, and the label carries the meaning either way.

## Theming

`--pretui-mark-hue` (set from the tone: `--success` by default, or `--primary`, `--pretui-info`, `--warning`, `--destructive`, `--pretui-attention`, `--muted-foreground`), `--pretui-indicator-size` (default 0.625rem) and `--pretui-indicator-ring` (the separating ring, default `--card`).

The ping's timing and scale are fixed.

## React ecosystem

| Agent types                          | Give them                             |
| ------------------------------------ | ------------------------------------- |
| Mantine `<Indicator color position>` | `<Indicator @tone @placement @label>` |
| Mantine `processing`                 | `@ping={{true}}`                      |
| Mantine `disabled`                   | `@invisible={{true}}`                 |
| MUI `<Badge variant="dot">`          | `<Indicator @label>`                  |
| a number                             | **Badge**                             |
