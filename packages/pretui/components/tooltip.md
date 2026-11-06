## What it is

A short label that appears on hover or keyboard focus, positioned against the element it wraps. Use it for naming icon-only controls and for abbreviating a value that is already visible. It is not a place to put information the user _needs_ — the content is one line, unselectable, and vanishes the moment the pointer leaves. If the user must read or interact with it, use **Popover**; if it is a persistent hint under a field, use **FormField**'s description slot; if it is a status message, use **Alert** or **Toast**.

## The contract

```
@content (string, required), @side? ('top'|'bottom'|'left'|'right', default 'top')
@labels? (boolean: the tip names its trigger instead of describing it)
@disabled? (boolean: keeps the tip hidden; the association stays)
<:default> — the trigger, rendered inline
```

That is the whole API, and the smallness is the point. Two decisions follow from it.

**The bubble is a manual popover.** Hidden, it is `display: none`: it takes no space, so a tooltip that would open past a scroll container's edge never makes that container scroll. Shown, it sits in the top layer, so no `overflow: hidden` ancestor clips it and it paints over every z-index, the Toaster included. Nothing runs until the tooltip opens; the reveal is a 120ms opacity fade, with `@starting-style` on the way in and `allow-discrete` on `display` and `overlay` on the way out. There is no show/hide delay, so tooltips flash as the pointer crosses a toolbar.

**Positioning is measured against the wrapper on open**, with the same `positionPopup` math the kit's `anchorTo` uses, and re-measured while open whenever the page scrolls, the window resizes, or the bubble or its trigger changes size, as when `@content` changes. `@side` is a preference: a tooltip without room on its side flips to the opposite one, and slides along its axis to stay on screen.

The tooltip is **always dark**, in both light and dark modes — the kit calls this "the lining". It is a deliberate constant so the affordance reads identically everywhere.

## Prior art

**Web Awesome `wa-tooltip`** is the fullest: `placement`, `distance`, `skidding`, `open`, `disabled`, `show-delay` (150ms) / `hide-delay`, `trigger` (`'hover focus'`, also `click`/`manual`), `without-arrow`, and a `for` attribute associating the tooltip to a trigger _by id_ rather than by wrapping it. **Radix `Tooltip`** requires a `Provider` so a group shares `delayDuration` and `skipDelayDuration` — cross the toolbar quickly and subsequent tooltips appear instantly, which is the single best tooltip detail in the ecosystem. **React Spectrum** adds warmup/cooldown timing and is explicit that tooltips must never contain interactive content.

Pretui is smaller than all three on purpose, and it is worth being clear that here the kit is _behind_, not ahead: no delay, no group coordination, no arrow. What it buys is a component that runs nothing until it opens.

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

`--tooltip` and `--tooltip-foreground` (the always-dark pair a theme must define for _both_ modes, not just light), `--shadow-lg`, and the `--boxel-font-size-xs`, `--boxel-sp-*` and `--boxel-border-radius-sm` steps. The 0.375rem offset is fixed. A theme that defines only a light value for `--tooltip` will produce a light-on-light tooltip in dark mode — this is the one token here that is easy to get wrong.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

Short string only. Rich hover content is **HoverCard**. Accept `delayDuration`
as `@openDelay`. WCAG 1.4.13: hoverable, dismissable (Esc), persistent.
