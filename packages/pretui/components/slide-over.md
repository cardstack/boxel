## What it is

**SlideOver** is **Drawer** under a name that cannot collide. shadcn calls this edge-anchored panel `Sheet`, but **Pretui `Sheet` is a spreadsheet**, so an agent that types Sheet for a slide-over gets the wrong component. SlideOver is the same export as Drawer, and the **Drawer** writeup carries the depth. A centred overlay is **Dialog**.

## The contract

```
@open?, @onClose?, @onOpenChange?
@label?          — the accessible name
@placement? ('start' | 'end' | 'bottom'; default 'end'; the React spellings map)
@dismissible? (default true)
<:title> <:default> <:footer>
Element: HTMLDialogElement
```

Identical to Drawer: a native `<dialog>` opened with `showModal()` and placed against one edge.

## Prior art

**shadcn `Sheet`** is Radix Dialog with a `side` of `top | right | bottom | left`. **MUI `Drawer`** takes `anchor`, `open`, `onClose` and `variant` (`temporary | persistent | permanent`). **Ant `Drawer`** takes `placement`, `open`, `onClose`, `size`, `extra` and `footer`. **Web Awesome `wa-drawer`** takes `placement` and `open`.

Drawer's placements are logical, so `end` is on the left in RTL. It has no `top` placement and no persistent or permanent mode. A panel that stays in the layout is **SplitPanes** or a sidebar, not a modal drawer.

## Accessibility

Identical to Drawer: APG **Dialog (Modal)**. A drawer is a dialog with geometry. `showModal()` supplies the focus trap, Escape, `::backdrop`, inert background and stacking. `@label` is the only labelling route, so pass it as well as any `<:title>`.

## Theming

Identical to Drawer: `--pretui-drawer-size`, `--card`, `--foreground`, `--muted-foreground`, `--border`, `--radius-surface`, `--pretui-shadow-overlay`, `--pretui-overlay-scrim`, `--text-heading`, `--weight-heading`, `--track-heading`, `--text-body`, `--leading-body`, `--space-3`, `--space-4` and `--space-6`.

## React ecosystem

| shadcn / MUI / Ant            | Pretui                         |
| ----------------------------- | ------------------------------ |
| shadcn `<Sheet side="right">` | `<SlideOver @placement='end'>` |
| MUI `anchor="left"`           | `@placement='start'`           |
| Ant `placement="bottom"`      | `@placement='bottom'`          |
| `open` / `onClose`            | `@open` / `@onClose`           |
| `SheetTitle`                  | `<:title>` plus `@label`       |
| MUI `variant="permanent"`     | **SplitPanes**, not a drawer   |
