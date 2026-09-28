## What it is

A modal window built on the native `<dialog>` element. Use it when a task must be finished or abandoned before the user returns to the page beneath — confirmations, destructive-action guards, short focused forms. Do not use it for anything the user should be able to work alongside; that is **Popover** (anchored, non-modal) or **Drawer** (edge-docked, still modal but sized for longer content). For transient, non-blocking notice use **Toast**; for inline blocking notice use **Alert**.

## The contract

```
@open, @onClose (required), @label?, @size? ('s'|'m'|'l'), @dismissible? (default true)
<:title> <:default> <:footer>
```

The one non-obvious decision: **the dialog is strictly controlled, and the platform is never allowed to close it.** The `cancel` event (Escape) is `preventDefault()`ed, and `@onClose` is called instead. So `@open` remains the single source of truth — the DOM cannot drift from your state. The consequence is that ignoring `@onClose` makes the dialog uncloseable; that is intended, and it is how `@dismissible={{false}}` is implemented (both Escape and backdrop click become no-ops).

The second decision: `showModal()` is driven from a modifier rather than from a template `{{on}}` handler, because the kit's lint rule `no-invalid-interactive` rejects listeners on `<dialog>`. The modifier syncs `open`→`showModal()` / `!open`→`close()` on every re-render, and owns the `cancel` and `click` listeners with matching teardown.

Backdrop detection is a nice trick worth understanding: the inner wrapper covers the whole dialog box, so any `click` whose `target === currentTarget` (the `<dialog>` itself) necessarily landed on the `::backdrop`. No hit-testing, no extra scrim element.

## Prior art

**Web Awesome `wa-dialog`** exposes `open`, `label`, `without-header`, `with-footer`, and `light-dismiss`. **Radix `Dialog`** composes `Root/Trigger/Portal/Overlay/Content/Title/Description/Close` with `open`/`onOpenChange`/`modal`, and implements its own focus trap, scroll lock and `aria-hidden` background over a plain `<div>`. **React Spectrum** wraps it in a `DialogTrigger` and adds `isDismissable`, `isKeyboardDismissDisabled`, and a `type` axis (`modal`/`popover`/`tray`) that swaps presentation by viewport.

Pretui differs on two axes deliberately.

_Default polarity._ Web Awesome makes light dismiss **opt-in** (`light-dismiss`); Pretui makes it **opt-out** (`@dismissible` defaults to `true`). Modals in this kit are overwhelmingly confirmations, and the safe-by-default reading is that a user can always get out; the rare "you must answer this" dialog pays the extra arg.

_Native top layer instead of a JS overlay stack._ Radix and Spectrum re-implement focus trapping, stacking and inertness in JavaScript because they target a portalled `<div>`. Pretui rides `showModal()`, which gives focus trapping, Escape via `cancel`, `::backdrop`, correct stacking of nested dialogs, and `inert` background _from the browser_, with no dismissible-stack bookkeeping and nothing to leak on teardown. That is a smaller, more correct implementation — the platform maintains it.

Entry/exit motion is pure CSS via `@starting-style`, so open state is encoded in the DOM rather than in an animation controller, and `prefers-reduced-motion: reduce` drops straight to the end state.

## Accessibility

Governing pattern: APG **Dialog (Modal)**. What the platform supplies via `showModal()`: `role="dialog"` + `aria-modal` semantics, focus trap, Escape, background inertness, top-layer stacking. What Pretui supplies: `aria-label` from `@label`.

Honest gaps:

- **`@label` is the only labelling route.** If you render a heading into `<:title>` there is no `aria-labelledby` wiring it to the dialog — you must _also_ pass `@label`, duplicating the string. Radix enforces a `Title` and warns when it is missing; Pretui does not warn.
- **No description wiring** (`aria-describedby`) for the body.
- **No initial-focus control.** The browser focuses the first focusable descendant. There is no `@initialFocus` equivalent to Spectrum's autofocus handling, so a destructive confirm dialog will focus whatever comes first in DOM order, not necessarily "Cancel".
- **Focus return on close** is the browser's default (back to the invoker) and is generally correct, but it is not asserted by the component — if the trigger unmounts while the dialog is open, focus is lost to `<body>`.
- Escape reaching `@onClose` depends on the caller actually flipping `@open`; a caller that ignores it silently creates a keyboard trap. Worth a lint rule.

## Theming

`--card`, `--foreground`, `--radius-surface`, `--pretui-shadow-overlay`, `--pretui-overlay-scrim` (the `::backdrop` fill), `--font-sans`, `--text-body`, `--text-heading`, `--weight-heading`, `--track-heading`, `--space-3/4/6`, `--border`, `--muted-foreground`, `--leading-body`. Widths are hard-capped at `min(400|560|760px, 100vw - 32px)` and height at `100dvh - 64px`; a season cannot retune those without a variant. `--pretui-overlay-scrim` is the token most seasons get wrong — it must read as a scrim in both light and dark, not simply invert.

## React ecosystem

Ant/Mantine/MUI agents will type **Modal** (alias stub). Destructive
confirms should be **AlertDialog**, not this.

| React                               | Pretui                    |
| ----------------------------------- | ------------------------- |
| Dialog / Modal                      | this tile                 |
| AlertDialog / Modal.confirm         | **AlertDialog**           |
| Sheet (slide-over)                  | **Drawer**                |
| `open` / `onOpenChange` / `onClose` | hybrid — accept `onClose` |
| `title` / `footer`                  | blocks                    |
| `fullScreen` / `size`               | @size                     |
