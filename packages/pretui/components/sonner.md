## What it is

**Sonner** is **Toaster** under the shadcn name (`emilkowalski/sonner`): the positioned region that stacks, ages and dismisses toasts pushed into a **ToastStore**. The export is the same class. Import it when a port already says Sonner; the **Toaster** writeup carries the depth. The presentation-only card is **Toast** (**Snackbar** is its MUI name) and is not what this host renders — the host draws its own item so the clock, roles and controls are one implementation.

## The contract

```
@store?                         — a ToastStore; the imperative half
@toasts? + @onDismiss?          — the controlled alternative; wins over @store
@placement? / @position?        — where the stack sits (default bottom-end)
@limit? @duration?              — cap (default 4) and default seconds (default 5)
@pauseOnHover? @pauseOnFocus? @pauseWhenHidden?
@label? @dismissLabel? @hotkey?
<:toast as |item|>              — draw the body yourself; the chrome stays
```

Identical to Toaster. `duration` is in seconds, and `0` makes a toast sticky.

## Prior art

**Sonner** exposes `toast()` as a module singleton with `toast.success` / `.error` / `.promise`, a `position`, `visibleToasts`, `closeButton`, `richColors` and `expand`. Toaster puts the imperative API on a store you instantiate — module-scope state in a realm is evaluated by the indexer and shared by every importer — and replaces `toast.promise` with `show({ id, … })` called again, which swaps a toast in place. Its cap is a real queue whose clocks have not started; Sonner keeps every toast alive behind the cap, so the ones never seen expire unseen. F6 moves focus into the region, which Sonner does not offer.

## Accessibility

A named landmark (`<section role='region' aria-label='Notifications' tabindex='-1'>`). Each toast carries `role='alert'` with `aria-live='assertive'` for `warning` and `danger`, `role='status'` with `aria-live='polite'` otherwise, `aria-atomic='true'` on both. F6 moves focus to the newest toast and back; dismissal hands focus to a neighbour or to where it came from, never the body; the clock pauses on hover and on focus. The life bar is `aria-hidden` and is exempt from reduced motion because stopping it would stop the dismissal. WCAG 2.2.1 is the caller's: give anything with an action a longer `duration`, or `0`.

## Theming

`--popover` and `--popover-foreground`, `--pretui-shadow-raised`, `--border`, `--radius-surface`, `--font-sans`, `--text-ui-md` and `--text-ui-sm`, `--muted-foreground`, `--foreground`, `--hover`, `--ring`, `--radius-control`, `--space-3` / `--space-4`. The tone stripe and life bar share `--pretui-toast-tone` per severity (`--pretui-info`, `--success`, `--warning`, `--destructive`, `--muted-foreground` for neutral). Host knobs: `--pretui-z-toast`, `--pretui-toaster-width`; entrance motion is `--pretui-dur-enter` / `--pretui-ease-enter`.

## React ecosystem

| Sonner | Pretui Sonner |
| --- | --- |
| `<Toaster position='bottom-right' />` | `<Sonner @store={{this.toasts}} @position='bottom-right' />` — mapped to `bottom-end` |
| `toast('Saved')` | `this.toasts.show({ title: 'Saved' })` |
| `toast.success(…)` / `.error(…)` | `show({ …, tone: 'success' })` / `tone: 'danger'` |
| `toast.promise(p, {…})` | `show` returns an id; `show({ id, … })` again replaces in place |
| `duration: 4000` | `duration: 4` — seconds |
| `visibleToasts` | `@limit` — the rest queue unstarted |
| `closeButton` | on by default; `dismissible: false` per toast |
| `pauseWhenPageIsHidden` | `@pauseWhenHidden` |
