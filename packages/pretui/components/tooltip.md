## What it is

A short label that appears on hover or keyboard focus, positioned against the element it wraps. Use it for naming icon-only controls and for abbreviating a value that is already visible. It is not a place to put information the user _needs_ — the content is one line, unselectable, and vanishes the moment the pointer leaves. If the user must read or interact with it, use **Popover**; if it is a persistent hint under a field, use **FormField**'s description slot; if it is a status message, use **Alert** or **Toast**.

## The contract

```
@content (string, required), @side? ('top'|'bottom'|'left'|'right', default 'top')
<:default> — the trigger, rendered inline
```

That is the whole API, and the smallness is the point. Two decisions follow from it.

**It is CSS-only.** There is no JavaScript, no timer, no state. The reveal is `:hover` / `:focus-within` on the wrapper toggling opacity. Consequences: it is prerender-safe (nothing to run before hydration), it cannot leak a timer, and it costs zero on a page with two hundred of them — which matters, because tooltips are what you sprinkle across a dense table. The cost is no show/hide delay, so tooltips flash as the pointer crosses a toolbar.

**Positioning is `position: absolute` against a `position: relative` wrapper, with no collision handling.** A tooltip on a control at the right edge of the viewport will overflow it. `@side` is a static choice, not a preference. This is a deliberate departure from the rest of the kit's overlays, which use the `anchorTo` measuring modifier — the trade is made for prerender safety and per-instance cost.

The tooltip is **always dark**, in both light and dark seasons — the kit calls this "the lining". It is a deliberate constant so the affordance reads identically everywhere.

## Prior art

**Web Awesome `wa-tooltip`** is the fullest: `placement`, `distance`, `skidding`, `open`, `disabled`, `show-delay` (150ms) / `hide-delay`, `trigger` (`'hover focus'`, also `click`/`manual`), `without-arrow`, and a `for` attribute associating the tooltip to a trigger _by id_ rather than by wrapping it. **Radix `Tooltip`** requires a `Provider` so a group shares `delayDuration` and `skipDelayDuration` — cross the toolbar quickly and subsequent tooltips appear instantly, which is the single best tooltip detail in the ecosystem. **React Spectrum** adds warmup/cooldown timing and is explicit that tooltips must never contain interactive content.

Pretui is smaller than all three on purpose, and it is worth being clear that here the kit is _behind_, not ahead: no delay, no group coordination, no collision flip, no arrow. What it buys is a component with no runtime at all.

One place Pretui is genuinely better: `@content` is a plain string, not a slot. Radix and Web Awesome accept arbitrary children, which invites people to put buttons and links inside tooltips — an accessibility disaster that every one of those libraries then documents against. Making the type `string` makes the mistake unrepresentable.

## Accessibility

Governing rules: APG **Tooltip** pattern (still marked as under review upstream, and widely regarded as the least settled pattern in the APG) and **WCAG 2.1 SC 1.4.13 Content on Hover or Focus**, which requires hover/focus-triggered content to be _dismissible_ (Escape without moving the pointer), _hoverable_ (the pointer can move onto it without it disappearing), and _persistent_ (it stays until dismissed, the pointer leaves, or it is no longer valid).

Pretui's honest scorecard:

- `role="tooltip"` is present on the bubble. **But the bubble is not associated with the trigger** — there is no `aria-describedby` and no `aria-labelledby`, and no id is generated. A screen-reader user focusing the trigger is told nothing. Since the tooltip is rendered unconditionally in the DOM (only opacity changes), the text is also read as ordinary adjacent content, at all times, whether or not the tooltip is showing. This is the component's most serious defect.
- Worth noting what the field has learned here: `wa-tooltip` deliberately uses **`aria-labelledby`, not `aria-describedby`**, with a comment that it gives the most consistent screen-reader result — several readers only announce `describedby` on a genuinely focusable element, whereas `labelledby` reads on first focus. The APG recommends `describedby`. Whichever Pretui adopts, adopting _one_ is the fix.
- **Not dismissible** (SC 1.4.13): no Escape handling.
- **Not hoverable** (SC 1.4.13): `pointer-events: none` on the bubble means moving the pointer onto the tooltip is impossible. For a one-line label this rarely matters in practice, but it is a literal failure of the criterion.
- Persistent: passes — there is no timeout.
- `white-space: nowrap` means long content will not wrap and will overflow rather than reflow.
- `:focus-within` correctly covers keyboard focus, so the _visual_ affordance is keyboard-reachable even though the semantic one is missing.

Do not ship a tooltip as the only name for an icon button until the association gap is closed — give the button an `aria-label` as well.

## Theming

`--tooltip` and `--tooltip-foreground` (the always-dark pair a season must define for _both_ modes, not just light), `--shadow-ink-strong`, `--text-ui-sm`. Radius (6px), padding and the 6px offset are hard-coded. A season that ships only a light palette for `--tooltip` will produce a light-on-light tooltip in dark mode — this is the one token here that is easy to get wrong.

## React ecosystem

Short string only. Rich hover content is **HoverCard**. Accept `delayDuration`
as `@openDelay`. WCAG 1.4.13: hoverable, dismissable (Esc), persistent.
