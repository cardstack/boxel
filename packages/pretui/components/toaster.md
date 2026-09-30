## What it is

The toast host: one fixed region per pane that stacks, ages and dismisses toasts. **Toast** is the card with no position, no stack, no clock and no live region — this component is where those policies live. Use it when something just happened and the user should hear about it without leaving what they are doing. If the message belongs in the page flow next to the thing it is about, that is **Alert**. If it needs a decision, it is a **Dialog**. If a notification must persist until read, it wants an inbox surface, not a toast.

Agents trained on shadcn will type `<Toaster />` and `toast('Saved')`; the second half arrives here as a `ToastStore` you instantiate rather than a module-level function, because module-scope mutable state in a realm is evaluated by the indexer, shared by every card that imports it, and impossible to reset between tests.

## The contract

```
@store?            — a ToastStore; the imperative half
@toasts?           — the controlled alternative: you own the array
@onDismiss?        — required with @toasts; called with the id that should leave
@placement?        — 'top-start' | 'top' | 'top-end' | 'bottom-start' | 'bottom' | 'bottom-end' (default 'bottom-end')
@position?         — the React spelling of @placement; 'bottom-right' and friends are mapped
@limit?            — how many render at once; the rest queue (default 4)
@duration?         — default seconds per toast; 0 is sticky (default 5)
@pauseOnHover?     — pause every clock while the pointer is over the region (default true)
@pauseOnFocus?     — pause every clock while focus is inside it (default true)
@pauseWhenHidden?  — pause every clock while the tab is hidden (default true)
@label?            — the region's accessible name (default 'Notifications')
@dismissLabel?     — the dismiss control's name (default 'Dismiss')
@hotkey?           — F6 moves focus into the region and back out (default true)
<:toast as |item|> — render the toast body yourself; the chrome stays the host's
```

**`ToastStore.show({ title, message?, tone?, duration?, dismissible?, actionLabel?, onAction?, onDismiss?, id? })`** returns the id. Ids come from a counter, so they are reproducible. Showing with an id that already exists replaces that toast in place — a "Saving…" becomes a "Saved" without the stack jumping. `store.dismiss(id)` and `store.clear()` remove, firing each toast's own `onDismiss`. The controlled half exists because a host that can only be told a toast left is not a host a parent controls; `@toasts` wins when both are given.

**The clock is a CSS animation, not a timer.** Each toast with a duration renders a life bar running for its own seconds, and the toast is removed on that element's `animationend`. That one decision is what the rest follows from: pausing is `animation-play-state`, so no elapsed time is measured or re-armed; a tab going hidden toggles the same property; where the animation never runs the toast simply waits to be dismissed rather than vanishing early. What it costs is an exit animation — removal is immediate and the survivors reflow with a transition. The duration is seconds, not milliseconds, and is clamped to 600.

**The cap is a queue, not a clip.** The first `@limit` toasts to arrive are the ones on screen; a toast already shown stays until it is dismissed, so a new arrival never pushes a running toast out. Toasts past the cap are not rendered, so their clock has not started, and the region shows how many are waiting. A `show` with an existing id replaces that toast and restarts its clock.

**Dismissal hands focus on.** Dismissing the toast you are focused on moves focus to the next toast's dismiss control, and when the last one goes, back to whatever had focus before the region was entered. Neither the action button nor the dismiss control ever drops focus on the body.

## Prior art

**Sonner** (what shadcn ships as `Toaster`) is `<Toaster position richColors closeButton>` plus a module-level `toast()` with `.success` / `.error` / `.promise`. It keeps every toast alive and shows three, so the ones behind the cap age out unseen; pause-on-hover is a wall clock it subtracts from; dismissing the focused toast drops focus. **Mantine Notifications** is a provider plus `notifications.show()`, queues past its limit but does not say so, and also runs timers. **Ant `notification`** is imperative, top-end by default, and mixes host and item. **MUI `Snackbar`** is one item with its own position and timer. **Base UI Toast** is the unstyled host-and-item split this follows, and the only one of the field that ships a hotkey to reach the region. **Web Awesome `wa-toast`** renders in the top layer via `popover='manual'`, FLIP-animates reflow and shares one body-level live region.

Where this is better: the cap is honest and announced; pause is a genuine pause with no clock to drift; a keyboard user can reach a toast at all (F6, and back out with F6); focus never strands on dismissal; and severity picks the live-region politeness instead of every toast interrupting equally.

Where it is thinner, plainly: **no exit animation** and **no swipe to dismiss** — both would need the timer this component refuses. **No `toast.promise`** — show once, then show again with the same id and a new title. **No module-level `toast()`** by design; every consumer instantiates a store. **No rich per-toast icon slot** in the default body — `<:toast>` replaces the whole body, not one part of it. **One live region per toast rather than one shared, persistent region** (Web Awesome's shape), which is the weaker architecture for announcements; see Accessibility.

## Accessibility

Governing pattern: APG **Alert** for the announcement, plus the live-region rules, plus WCAG 2.2.1 for anything timed.

- **The region is a named landmark**: `<section role='region' aria-label='Notifications' tabindex='-1'>`, so it appears in the rotor and can take focus. `@label` renames it.
- **Each toast carries its own role and politeness** — `role='alert'` with `aria-live='assertive'` for `warning` and `danger`, `role='status'` with `aria-live='polite'` for the rest, `aria-atomic='true'` on both. Severity is the only thing that chooses; a save confirmation never interrupts and a failure never waits behind three other announcements.
- **The live region mounts with its content already in it**, because the toast is its own live region. Screen readers announce a region that appears populated less reliably than one that was present and then written into. If announcements matter more than layout, keep the region rendered from first paint — the fixed section is always in the DOM while the component is — and be aware that each toast element is still new.
- **A keyboard user can reach a toast.** F6 from anywhere moves focus to the first focusable control in the newest toast; F6 from inside returns focus to where it came from. The test asserts both halves. `@hotkey={{false}}` removes it, and then the region is reachable only by tabbing to wherever it sits in the DOM.
- **Dismissal never drops focus on the body.** Focus goes to the neighbouring toast's dismiss control, or back to the element that had focus before the region was entered. Asserted.
- **The clock pauses on focus** as well as hover, so a toast you have reached with F6 does not expire under you. A sticky toast (`duration: 0`) has no life bar at all.
- **The life bar is `aria-hidden`** and is the remaining time as a non-colour channel. It is deliberately exempt from the reduced-motion branch: stopping it would stop the dismissal itself, which WCAG 2.3.3 allows for motion essential to the information conveyed. Only the entrance transition is removed.
- **The dismiss control has an accessible name** (`@dismissLabel`, default 'Dismiss') and grows its hit area to 44px on a coarse pointer without growing its ink.
- What is the caller's: **2.2.1 Timing Adjustable.** The default five seconds is short for anything with an action. Give a toast with an Undo a longer `duration`, or `0` and let the user dismiss it. And `<:toast>` replaces the body only — the roles, clock and controls stay — so do not put another live region inside it.

## Theming

Surface: `--popover` and `--popover-foreground` (the toast reads as "floating above", like **Menu** and **Popover**, not like **Panel**), `--pretui-shadow-raised`, `--border`, `--radius-surface`, `--font-sans`, `--text-ui-md` (title) and `--text-ui-sm` (message, queue pill), `--muted-foreground`, `--foreground`, `--hover`, `--ring`, `--radius-control` (the two buttons), `--space-3` / `--space-4`.

The tone stripe and the life bar share one hue per severity through `--pretui-toast-tone`: `--pretui-info`, `--success`, `--warning`, `--destructive`, and `--muted-foreground` for neutral. The stripe is the only place a tone paints, so a neutral toast is genuinely neutral.

The host's own knobs: `--pretui-z-toast` (stacking, default 100), `--pretui-toaster-width` (380px, capped to the viewport less 24px), and `--pretui-toast-life`, which the component sets per toast to its own duration — a season does not set it. Entrance motion is `--pretui-dur-enter` / `--pretui-ease-enter`.

Fixed: the 3px stripe, the 2px life bar at 0.55 opacity, the 20px dismiss control (28px on coarse pointers), and the 12px entrance offset.

## React ecosystem

| Sonner / Mantine / Ant / MUI | Pretui |
| --- | --- |
| `<Toaster position='bottom-right' />` | `<Toaster @store={{this.toasts}} @position='bottom-right' />` — mapped to `bottom-end` |
| `toast('Saved')` | `this.toasts.show({ title: 'Saved' })` |
| `toast.success(…)` / `.error(…)` | `show({ …, tone: 'success' })` / `tone: 'danger'` |
| `toast.promise(p, {…})` | `show` returns an id; `show({ id, … })` again replaces in place |
| `duration: 4000` | `duration: 4` — seconds |
| `visibleToasts` / `limit` | `@limit` — the rest queue unstarted |
| `closeButton` | on by default; `dismissible: false` per toast |
| `pauseWhenPageIsHidden` | `@pauseWhenHidden` (default true) |
| `hotkey` (Base UI, F6) | `@hotkey` (default true, F6) |
| `anchorOrigin` (MUI) | `@placement` |

**Toast** is the presentation-only card and is not what this host renders; the host draws its own item so the clock, roles and controls are one implementation. **Sonner** and **Snackbar** are the shadcn and MUI names for this component.
