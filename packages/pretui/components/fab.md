## What it is

**Fab** is **FloatButton** under the name MUI uses. The export is the same component. Import it when a port already says Fab. The **FloatButton** writeup carries the depth. MUI splits the single button (`Fab`) from the cluster (`SpeedDial`), and here both are the one component: pass `@actions` and the button opens a speed dial.

## The contract

```
@label, @extended?, @tone?, @placement?, @position?, @size?
@onAction?, @actions?, @open?, @onOpenChange?
<:default>      — the icon
<:actionIcon>   — one dial action's icon
```

Identical to FloatButton. `@label` is required because an icon-only button needs an accessible name, and with `@extended` the same label is the visible text.

## Prior art

**MUI `Fab`** takes `color`, `size`, `variant` (`circular | extended`) and `disabled`. It is a styled button with no positioning, so every app adds its own `position: fixed` and offsets. **MUI `SpeedDial`** is a separate component with `ariaLabel`, `icon`, `open`, `direction` and `SpeedDialAction` children that show their names as tooltips.

FloatButton positions itself in a corner of its container, maps `bottom-right`-style spellings onto logical corners, and folds SpeedDial into `@actions`. The dial shows each action's label as visible text, not a tooltip. It does not take `direction`: the dial opens away from the corner it sits in.

## Accessibility

Identical to FloatButton. The button is named by `@label`. With `@actions` it is a disclosure: `aria-expanded` and `aria-controls` on the button, a list of real buttons in the dial, focus never moved on open, and Escape, an outside press or a choice closes it and returns focus to the button. MUI's SpeedDial names its actions only through tooltips, which a touch user never sees.

## Theming

Identical to FloatButton: `--pretui-float-size`, `--pretui-float-offset`, `--pretui-float-z`, `--pretui-shadow-raised`, `--popover` and `--popover-foreground` for the dial, and Button's tone tokens for the main button.

## React ecosystem

| MUI                                         | Pretui                                            |
| ------------------------------------------- | ------------------------------------------------- |
| `<Fab color="primary" aria-label="add">`    | `<Fab @label='Add' />` (tone defaults to primary) |
| `variant="extended"`                        | `@extended={{true}}`                              |
| `sx={{ position: 'fixed', bottom, right }}` | `@placement` + `@position='fixed'`                |
| `<SpeedDial>` + `<SpeedDialAction>`         | `@actions`                                        |
| `SpeedDial direction`                       | not supported: it follows the corner              |
