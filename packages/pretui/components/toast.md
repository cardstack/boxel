## What it is

A small raised card announcing that something just happened — saved, copied, failed, undone. It is presentation only: it does not position itself, stack, queue or dismiss. You render it wherever your host puts notifications and you own its lifetime. If the message belongs in the page flow next to the thing it is about, use **Alert**. If it belongs to a field, use **FieldError**. If it needs a decision from the user, it is a **Dialog**, not a toast.

## The contract

```
@title: string   (required)
@message?
<:icon>  <:action>
```

That is all. There is no `duration`, no `placement`, no `variant`, no close button, and no toast _container_.

**The omissions are the design.** A toast stack is a host concern: it needs a single top-layer region, an ordering policy, a pause-on-hover rule, and one shared live region — and none of that belongs to a component that a card might render three of. Pretui ships the card here and the stack as **Toaster**, which draws its own item so the clock, roles and controls are one implementation. The upside is that a Toast composes into anything; the downside is that using it correctly requires you to build the parts that are hard.

`width: max-content` with a 360px cap means a toast is as wide as its content and no wider, which is what makes a stack of them read as a column of distinct messages rather than a wall.

## Prior art

**Web Awesome** splits it exactly where Pretui does not: `wa-toast` is the _stack_ — one property (`placement`, six corner values), rendered in the **top layer** via `popover="manual"` rather than a z-index, FLIP-animating items on reflow (skipped under reduced motion), Escape dismissing the newest, and — the important part — **one shared, ref-counted, body-level live region** rather than a live region per toast. `wa-toast-item` is the card: `variant`, `size`, `duration` (default 5000, 0 = sticky), pause-on-hover/focus, and a countdown progress ring that is `aria-hidden`.

**Radix `Toast`** uses a `Provider` + `Viewport` with an `aria-live` region, `type="foreground" | "background"` mapping to assertive/polite, swipe-to-dismiss, and an **F8 hotkey** that jumps focus to the toast region — the best answer anyone has to "how does a keyboard user reach a toast before it disappears".

**shadcn** wraps Radix. **React Spectrum** has no toast in the stable release, which is itself a statement about how hard the pattern is.

So: Pretui ships roughly `wa-toast-item` and none of `wa-toast`. Against those references it is not better, it is **less** — deliberately, but the gap is real and worth naming rather than dressing up.

The one thing it does better than `wa-toast-item`: `<:icon>` and `<:action>` are open slots rather than a fixed variant glyph, so a toast can carry an **Avatar**, a **Spinner** or an Undo **Button** without a variant escape.

## Accessibility

Governing pattern: APG **Alert** for the announcement, plus the live-region rules. This is the weakest area, and most of it follows from what the component deliberately does not own.

- **`role="status"` is hardcoded on every toast**, so a failure notification is announced politely and may be queued behind other speech. Radix's `foreground`/`background` split and Web Awesome's variant-driven `alert`/`status` choice both exist for this. There is no tone arg here at all.
- **Each toast is its own live region, created with its content already in it.** This is the classic failure mode: a live region must be in the DOM _before_ the content changes. A toast that mounts complete will frequently announce nothing. The correct architecture is Web Awesome's and React Aria's — one persistent hidden region that messages are written into — and it cannot be built inside this component. If you build a stack, build that region too.
- **No timeout, so no WCAG 2.2.3 concern** — which is genuinely the safe side. But since dismissal is entirely the caller's, a caller who adds a 3-second auto-dismiss inherits **2.2.1 Timing Adjustable** with no help from the component.
- **No close button**, so a keyboard user cannot dismiss a toast, and **no way to reach one**: there is no Escape handling and no equivalent of Radix's F8 region hotkey. A toast carrying an `<:action>` Button is reachable only by tabbing to wherever it happens to sit in the DOM.
- **`<:icon>` content is not `aria-hidden` by the component**, so a decorative icon that emits a `<title>` will be read before the title text.
- The title and message are plain text with no heading semantics — correct for a transient card.

Practical guidance: render Toast inside a host-owned region that carries the live semantics, keep `role="status"` on the region rather than the card, and give anything actionable a persistent home as well.

## Theming

`--popover` (surface), `--pretui-shadow-raised`, `--border`, `--foreground` (title), `--muted-foreground` (message), `--text-ui-md`. The 10px radius, 7px/10px padding, 9px gap and 360px max width are fixed.

Because the surface is `--popover` rather than `--card`, a toast matches **Menu** and **Popover** rather than **Panel** — the "floating above" vocabulary. A season must keep `--popover` distinct from the page background, since the only other separation is a shadow, and shadows disappear on dark surfaces.

## React ecosystem

Toast is **presentation only** — no stack, duration, or live region.
That is deliberate and correct. The host is **Toaster** (shadcn
**Sonner**, MUI **Snackbar** host, Mantine Notifications): `duration`,
`placement` and `tone` live there, on the item you `show()`, not here.
