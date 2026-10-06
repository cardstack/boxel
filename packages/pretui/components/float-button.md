## What it is

A **corner-anchored primary action** for a long pane: Compose, New task, Back to top, Help. It sits in a corner of its positioned container, above the content, and stays put while the content scrolls under it. With `@actions` it becomes a **speed dial**, a button that opens a short list of related actions.

Reach for a neighbour when the action does not float:

- **Button** or **IconButton** for an action in the flow of a toolbar or form.
- **ActionBar** for a band of actions tied to a selection.
- **Menu** for a long list of commands behind a trigger, with arrow-key navigation.

**Fab** is this component under the MUI name.

## The contract

```
@label, @extended?
@tone? (default 'primary'), @size? ('s' | 'm' | 'l'; default 'm')
@placement? ('bottom-end' | 'bottom-start' | 'top-end' | 'top-start'; default 'bottom-end')
@position? ('absolute' | 'fixed'; default 'absolute')
@onAction?
@actions? ({ id, label, onSelect? }[]), @open?, @onOpenChange?
<:default>                  — the icon (defaults to a plus)
<:actionIcon as |entry|>    — one dial action's icon
Element: HTMLDivElement
```

**It anchors to its pane, not the viewport.** The default `@position='absolute'` places it in a corner of the nearest positioned ancestor. A button that belongs to a list panel stays inside that panel and never floats over the neighbouring pane or the app chrome. `@position='fixed'` is there for the page-level case. Corners are logical, so RTL flips `bottom-end` to the left, and the React spellings (`bottom-right`, `top-left`…) map.

**`@label` is always the name.** Icon-only, it becomes the button's `aria-label`. With `@extended`, it is the visible text beside the icon and the `aria-label` is dropped, so the name is not doubled.

**With `@actions` the button opens instead of acting.** `@onAction` is not fired. The dial opens away from the corner, upward from a bottom corner and downward from a top one. Each action is a real button that shows its label as text. Choosing one calls its `onSelect`, closes the dial and returns focus to the main button. Escape and a pointer press outside also close it. The dial can be controlled with `@open` and `@onOpenChange`.

## Prior art

**Ant FloatButton** takes `type`, `shape`, `icon`, `description`, `tooltip`, `badge` and `href`. It adds `FloatButton.Group` (a `trigger` of `click | hover`, with `open`) and `FloatButton.BackTop`, and is always `position: fixed`. **MUI** splits it in two: `Fab` is a styled button that the caller positions, and `SpeedDial` takes `SpeedDialAction` children whose names appear as tooltips. **Chakra** has no component.

Where Pretui is better: **local anchoring by default.** Ant's fixed positioning ignores the pane the button belongs to, and MUI leaves positioning to every caller. **Dial actions are labelled with visible text**, not tooltips a touch user never sees and a screen reader user may not get. **Opening never steals focus.** MUI SpeedDial moves focus into its actions on open, and Ant's hover trigger opens the group under a passing pointer. **One component** covers the single action and the dial.

Where it is thinner: **no hover trigger**, deliberately. **No badge**; compose one inside the icon block. **No `href`**: it is always a button. **No back-to-top built in**: pass an `@onAction` that scrolls the pane, not `window`. **No arrow-key movement** between dial actions. Tab moves through them, which is right for a short list and wrong for a long one; use **Menu** for that.

## Accessibility

APG **Disclosure** pattern for the dial. A lone FloatButton is a plain button.

- **The main button is a real `<button>` named by `@label`.** The tests assert the name in both the icon-only and the extended forms.
- **With `@actions`**, the button carries `aria-expanded` and `aria-controls` pointing at the dial. The dial is `hidden` while closed. The tests assert the pairing and both states. Without actions, `aria-expanded` is absent, and the tests assert that too.
- **Focus is not moved on open.** The user tabs into the dial. The tests assert focus stays out of it.
- **Closing returns focus.** Escape, or choosing an action, closes the dial and puts focus back on the main button. The tests assert both. A pointer press outside closes it without moving focus.
- **The icon is `aria-hidden`.** The label names the button, not the glyph.
- **The caller owns the collision.** A floating button covers the content beneath its corner. Leave padding at the end of the pane so the last row is never trapped under it.

## Theming

`--pretui-float-size` (the button's minimum width and height, default 3rem), `--pretui-float-offset` (the distance from the corner, default `--space-6`), `--pretui-float-z` (local stacking, default 20), `--pretui-shadow-raised`, `--popover` and `--popover-foreground` (the dial actions), `--ring`, `--muted-foreground` (action icons), `--text-ui-md`, `--space-2` / `--space-3` / `--space-4` / `--space-5`, and `--pretui-dur-snap` / `--pretui-ease-snap` (the icon's quarter-turn and the dial's entrance). The main button's colour comes from **Button**'s tone tokens.

The round shape and the plus turning to a cross when open are fixed. Both motions are dropped under `prefers-reduced-motion`.

The styles sit in `@layer PretComposite`, above Button's `PretComponent` layer, so what this component sets on Button wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.

## React ecosystem

| Agent types                                         | Give them                                     |
| --------------------------------------------------- | --------------------------------------------- |
| Ant `<FloatButton icon onClick>`                    | `<FloatButton @label @onAction>` + icon block |
| Ant `FloatButton.Group trigger="click"`             | `@actions`                                    |
| Ant `FloatButton.BackTop`                           | `@onAction` that scrolls the pane             |
| MUI `<Fab>` / `variant="extended"`                  | **Fab** / `@extended`                         |
| MUI `<SpeedDial>` + `<SpeedDialAction>`             | `@actions` with `<:actionIcon>`               |
| `sx={{ position: 'fixed', bottom: 16, right: 16 }}` | `@position='fixed'` + `@placement`            |
