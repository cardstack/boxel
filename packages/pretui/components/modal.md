## What it is

**Modal** is **Dialog** under the name Ant, Mantine, MUI and React Aria use. The export is the same component. Import it when a port already says Modal; the **Dialog** writeup carries the depth. A destructive confirmation should be **AlertDialog**, not a Modal with two buttons, and a small question next to its trigger is **Popconfirm**.

## The contract

```
@open?, @onClose?, @onOpenChange?
@label?          — the accessible name
@size? ('s' | 'm' | 'l'; sm / md / lg accepted)
@dismissible? (default true)
<:title> <:default> <:footer>
Element: HTMLDialogElement
```

Identical to Dialog: a native `<dialog>` opened with `showModal()`.

## Prior art

**Ant `Modal`** takes `open`, `title`, `onOk`, `onCancel`, `footer`, `width`, `maskClosable` and `keyboard`, and has an imperative `Modal.confirm()`. **Mantine `Modal`** takes `opened`, `onClose`, `title`, `size`, `centered` and `closeOnClickOutside`. **MUI `Modal`** is the unstyled layer under MUI `Dialog`. **React Aria `Modal`** is the overlay that wraps a `Dialog`.

Dialog gets the focus trap, Escape, background inertness and top-layer stacking from the platform, where each of those kits reimplements them. It is thinner in one place: there is no `onOk` / `onCancel` footer. The footer is a block you fill with Buttons.

## Accessibility

Identical to Dialog: APG **Dialog (Modal)**. `showModal()` supplies the dialog role, modality, the focus trap, Escape and inert background. `@label` is the accessible name and the only labelling route. A heading in `<:title>` is not wired through `aria-labelledby`, so pass `@label` as well.

## Theming

Identical to Dialog: `--card`, `--foreground`, `--muted-foreground`, `--border`, `--radius-surface`, `--pretui-shadow-overlay`, `--pretui-overlay-scrim`, `--text-heading`, `--weight-heading`, `--track-heading`, `--text-body`, `--leading-body`, `--space-3`, `--space-4` and `--space-6`.

## React ecosystem

| Ant / Mantine / MUI                    | Pretui                        |
| -------------------------------------- | ----------------------------- |
| `open` / `opened`                      | `@open`                       |
| `onCancel` / `onClose`                 | `@onClose` or `@onOpenChange` |
| `title`                                | `<:title>` plus `@label`      |
| `footer` / `onOk`                      | `<:footer>` with Buttons      |
| `maskClosable` / `closeOnClickOutside` | `@dismissible`                |
| `Modal.confirm({...})`                 | **AlertDialog**               |
