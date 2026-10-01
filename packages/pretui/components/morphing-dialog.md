## What it is

A card that grows into a dialog: the resting card is the trigger, and its rectangle is what the dialog expands out of.

## The contract

```
@label (required) — accessible name, and the visible title when no <:title> is given
@open?, @onOpenChange? — controlled / uncontrolled
@size?        — dialog width preset, forwarded to Dialog. Default 'm'
@dismissible? — allow Escape and backdrop dismissal. Default true

<:trigger> the resting card; it becomes the trigger and the growth origin
<:title>   visible dialog title; falls back to @label
<:default> dialog body
```

**The trigger's rectangle is the origin of the growth**, which is the whole effect: the dialog appears to be the card, larger, rather than a panel arriving over it.

**It forwards to the kit's Dialog**, so the focus trap, Escape handling and backdrop are that component's rather than being re-implemented around an animation.

**`@label` does double duty** — the accessible name always, and the visible title when `<:title>` is absent — so a dialog is never nameless.

## Prior art

The morphing-card-to-dialog effect in motion libraries.

Where Pretui is better: it is a real dialog underneath. The upstream implementations animate a div into position and leave focus management, Escape and the backdrop to the integrator, which in practice means a beautiful modal you cannot close with the keyboard.

Where it is thinner: no shared-element transition across routes, no drag-to-dismiss, and the morph is size and position only — content does not cross-fade between the two states.

## Accessibility

- **The dialog is the kit's Dialog**, which brings the focus trap, Escape, and focus return to the trigger.
- **The trigger is a real control**, so opening is a keyboard action rather than a click on a card.
- **`@label` guarantees a name**, and a dialog without one is announced as an unnamed modal.
- **`@dismissible={{false}}` removes Escape and backdrop dismissal**, which should only be used when the dialog's own content provides an unmissable way out.
- **The morph is decoration over a state change that is already announced.** Reduced motion should land on the open dialog, which costs nothing because the dialog is the end state.

## Theming

Everything comes from **Dialog** and the kit's shared motion tokens; the morph uses the shared duration and easing.

There is no morph-specific palette, so a morphing dialog and an ordinary one are the same surface arriving two ways.
