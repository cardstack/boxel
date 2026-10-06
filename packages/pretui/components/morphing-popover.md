## What it is

A trigger that grows into a popover: the panel expands out of the control that opened it.

## The contract

```
@label (required) — accessible name for the panel
@open?, @onOpenChange? — controlled / uncontrolled
@placement?   — where the panel sits relative to the trigger. Default 'bottom-start';
                it flips and shifts to stay on screen
@distance?    — gap between trigger and panel in px. Default 8
@matchWidth?  — match the panel's minimum width to the trigger's. Default false

<:trigger> the trigger's face
<:default> the panel contents; receives a `close` action
```

**The panel block receives `close`**, so a control inside the panel can dismiss it without the caller tracking state. That is the arg that stops every consumer from wiring up an `@open` just to close from the inside.

**Placement flips and shifts to stay on screen**, so `@placement` is a preference rather than an instruction.

**`@matchWidth` is off by default**, because a popover as narrow as a small trigger is usually wrong — the arg exists for the select-like case where matching is right.

## Prior art

The morphing-popover effect in motion libraries, over the kit's own anchoring.

Where Pretui is better: real anchoring with flip and shift, and a close action yielded into the panel. The upstreams animate a positioned div and leave both to the caller.

Where it is thinner: no arrow or tail pointing at the trigger, no nested popovers, and no hover-open mode — this opens on activation only.

## Accessibility

- **The panel is named** through `@label`, which is what a screen reader announces on open.
- **`close` being yielded is an accessibility affordance as much as a convenience**: a panel whose only dismissal is Escape or an outside click is harder to leave deliberately.
- **The trigger is a real control** and focus returns to it on close.
- **Flip and shift keep the panel on screen**, which matters for every input method equally — an off-screen panel is unreachable, not merely ugly.
- **The morph is decoration over an already-announced state change**; reduced motion lands on the open panel.

## Theming

The panel takes the kit's overlay tokens and the morph the shared motion tokens.

`@distance` is a caller value rather than a token because the right gap depends on the trigger, not on the season.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
