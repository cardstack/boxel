## What it is

A **count or status mark on the corner of another control**: the unread 3 on an inbox button, 99+ on an avatar, a dot on a tab with new activity. It wraps the control and overlays the mark on one corner.

Reach for a neighbour when the mark is something else:

- **Chip** is an inline label in the flow of text. That is what shadcn calls `Badge`.
- **StatusChip** is a tone-mapped inline chip.
- **Indicator** is a named dot with no number, such as online or live.

## The contract

```
@count?, @max? (default 99), @dot?, @showZero?, @invisible?
@tone? (default 'danger'), @placement? ('top-end' | 'top-start' | 'bottom-end' | 'bottom-start'; default 'top-end')
@circular?, @label?
<:default>   — the control the badge sits on
Element: HTMLSpanElement
```

**The number is shown; the meaning is spoken.** The visible mark is `aria-hidden`, because a bare "3" read in the middle of a button name means nothing. The count, followed by `@label`, is a visually hidden run after the child: `@label='unread'` gives "3 unread". The child's first focusable element points at that run with `aria-describedby`, so focusing an inbox button reads "Messages, button, 3 unread": its own name, then the count. Existing descriptions on the child are kept.

**Display rules.** Above `@max` the mark reads `99+` (or `9+` with `@max={{9}}`), and the spoken count stays exact. A count of 0 hides the badge unless `@showZero`. `@dot`, or no `@count` at all, draws a dot without a number. `@invisible` hides the mark and its announcement without unmounting the child.

**Placement is logical**, so `top-end` follows the reading direction in RTL and the mark still straddles the corner, and the MUI and Mantine physical spellings (`top-right`…) map. `@circular` pulls the mark in toward a round child such as an **Avatar** so it sits on the curve, not in empty space.

## Prior art

**MUI `Badge`** takes `badgeContent`, `max`, `showZero`, `invisible`, `variant` (`standard | dot`), `color`, `anchorOrigin` and `overlap` (`rectangular | circular`). **Ant `Badge`** takes `count`, `overflowCount`, `dot`, `showZero`, `offset`, `color` and `status`. **Mantine** puts the overlay on `Indicator` and keeps `Badge` inline. **shadcn `Badge`** is inline only.

Where Pretui is better: **the announcement is built in.** MUI and Ant render the count as plain text inside the badge, so a screen reader reads "Messages 3" or reads the number with no context. Here focus reads the child's own name and then "3 unread" as its description. **Placement is logical** rather than physical.

Where it is thinner: **no `offset`** for pixel nudging; `@circular` covers the common case. There is **no custom content**: the mark is a number or a dot, not arbitrary markup. **No `status` text mode** as in Ant; use **StatusChip**.

## Accessibility

No APG pattern. What matters is the name.

- **The mark is `aria-hidden`.** The tests assert it.
- **The spoken run follows the child**, "3 unread", and the child's text is untouched. A focusable child is described by the run (`aria-describedby`). The tests assert the run, the exact count above `@max`, the child's name, and the description wiring.
- **Hidden means silent.** A zero badge without `@showZero`, and an `@invisible` badge, have no spoken run either. The tests assert both.
- **Give `@label` the meaning**, not the colour. "unread", "new", "failed builds".
- **Live changes are not announced.** A count that ticks up while the user is elsewhere is not a live region. If the change matters right now, announce it separately, for example with **Toaster**.

## Theming

`--pretui-mark-hue` (set from the tone: `--destructive` by default, or `--primary`, `--pretui-info`, `--success`, `--warning`, `--pretui-attention`, `--muted-foreground`), `--pretui-badge-ink` (the number, default `--card`), `--pretui-badge-ring` (the separating ring, default `--card`), `--foreground` (ink on warning and attention hues), `--font-sans` and `--text-ui-xs`.

The ring mixes against `--card`, so the mark reads as cut out of the control in any season. The 1.125rem height, the 0.5rem dot and the half-out corner offset are fixed.

## React ecosystem

| Agent types                       | Give them                         |
| --------------------------------- | --------------------------------- |
| MUI `<Badge badgeContent={4}>`    | `<Badge @count={{4}} @label='…'>` |
| MUI `max` / Ant `overflowCount`   | `@max`                            |
| MUI `variant="dot"` / Ant `dot`   | `@dot={{true}}`                   |
| MUI `anchorOrigin` / Ant `offset` | `@placement`; no pixel offset     |
| MUI `overlap="circular"`          | `@circular={{true}}`              |
| shadcn `<Badge>` (inline)         | **Chip**                          |
