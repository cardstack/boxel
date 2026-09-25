## What it is

A non-modal floating panel anchored to a trigger, holding arbitrary content. Reach for it when a user needs to see or edit something _alongside_ the page rather than instead of it: a filter panel, a colour picker, a quick-edit form, a "details" card off an inline reference. If the content is a flat list of commands, use **Menu**. If the interaction must block the page, use **Dialog** or **Drawer**. If it is a passive one-line hint that appears on hover, use **Tooltip**.

## The contract

```
@placement? (PopupPlacement, default 'bottom-start'), @distance? (default 6), @label? (default 'Popover')
<:trigger as |open toggle|>  <:default as |close|>
```

Two decisions.

**It owns its open state.** There is no `@open`/`@onOpenChange` pair. The trigger block gets `(open, toggle)` so it can render its own expanded affordance, and the default block gets `close` so panel content can dismiss itself after committing — the "Apply" button in a filter popover calls `close` directly. This makes the common case a two-line call site; it also means you cannot open a Popover programmatically or coordinate two of them. If you need that, compose **Popup** yourself.

**Dismissal is a real element, not a document listener.** While open, the panel renders a transparent, viewport-covering `<button tabindex="-1">` behind itself; clicking it closes. This is the kit's generalisation of the Select backdrop-close pattern. It is deliberately not a `document.addEventListener('click', …)`: a document listener has to be attached and removed in lifecycle hooks, can outlive teardown, fires during capture in ways that fight nested overlays, and does not work cleanly inside a scoped island. A DOM node's lifetime _is_ the open state, so there is nothing to leak.

Panel width is set by three component-owned custom properties — `--pretui-popover-width`, `--pretui-popover-min-width` (200px), `--pretui-popover-max-width` (`min(360px, 100vw - 16px)`) — settable from any ancestor, so no `:deep()` is ever required to resize one.

## Prior art

**Radix `Popover`** composes `Root/Trigger/Anchor/Portal/Content/Arrow/Close`, is controlled via `open`/`onOpenChange`/`defaultOpen`, and adds `modal`, `collisionPadding`, `avoidCollisions`, `onEscapeKeyDown`, `onPointerDownOutside`, and full focus management (`onOpenAutoFocus`/`onCloseAutoFocus`). **Web Awesome `wa-popover`** takes `open`, `placement`, `distance`, `skidding`, `without-arrow` and a `for` attribute that associates it to a trigger by id. **React Spectrum** models it as `DialogTrigger type="popover"` and reuses the whole dialog machinery, including `isNonModal`.

Where Pretui differs:

- **The backdrop element instead of outside-click detection** (above) — smaller, leak-free, and correct inside the theme island.
- **No portal.** Everything else here portals to `document.body`; Pretui renders in place so season tokens and scoped styles apply. The cost is that a Popover inside `overflow: hidden` relies on `Popup`'s `position: fixed` to escape clipping, which works, but the panel still sits in the anchor's stacking context.
- **`close` yielded to content** rather than a separate `Popover.Close` component. One fewer export, and it composes with any control.
- **`--pretui-popover-*` sizing knobs.** Radix leaves width to the consumer's CSS and exposes `--radix-popover-trigger-width` as a read; Pretui inverts it into three writable knobs with sane defaults.

Missing versus the field: no arrow, no `skidding`, no `collisionPadding` (the gutter is a fixed 8px in `anchorTo`), no `modal` mode, no controlled API.

## Accessibility

Governing pattern: APG **Dialog (Non-Modal)**.

Present: `role="dialog"` on the panel, `aria-label` from `@label` (defaulting to the unhelpful literal `'Popover'`), `tabindex="-1"` so the panel is programmatically focusable, Escape closing while focus is inside the panel or on the trigger, and an `aria-label="Close"` backdrop that is `tabindex="-1"` so it never appears in tab order.

Gaps, plainly:

- **Focus is never moved into the panel on open, and never restored to the trigger on close.** APG's non-modal dialog pattern expects both. In practice a keyboard user opens the Popover and then has to Tab forward through it, and after closing, focus is wherever it was.
- **Escape only works if focus is already inside the panel** — the `keydown` handler is on the panel, not on the wrapper. Open the Popover by clicking the trigger, leave focus on the trigger, press Escape: nothing happens. This is a real bug, not a design choice.
- **The trigger is not wired.** `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls` are the caller's responsibility; the yielded `open` flag is the raw material but nothing applies it.
- **`@label` defaults to `'Popover'`**, which is worse than no label in a page with several. Always pass one.
- No focus containment, correctly — it is non-modal, and Tab should be able to leave.

## Theming

`--popover`, `--popover-foreground` (falling back to `--foreground`), `--pretui-shadow-overlay`, `--space-4`, plus the three `--pretui-popover-*` sizing knobs. Radius is hard-coded at 10px rather than reading `--radius-surface` — a genuine inconsistency with Dialog and Panel that a season cannot currently override. Entry motion is `@starting-style` (opacity + 4px rise, 180ms) with a `prefers-reduced-motion` opt-out.

## React ecosystem

Click-to-open rich surface. Hover preview is **HoverCard**. String
hint is **Tooltip**. Confirm-next-to-trigger is **Popconfirm**.
Accept `open` / `onOpenChange` / `side` / `align` → `@placement`.
