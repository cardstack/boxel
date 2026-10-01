## What it is

A message the user has typed while the agent is busy, shown with its **delivery semantics stated in the UI**: `steer` is delivered at the next checkpoint, `now` interrupts. Use it in the composer area of an agent surface for anything queued behind a running turn. If the message has already been delivered, it is a transcript row, not this. If the agent is asking *you* something, **AgentQuestion**.

## The contract

```
@text: string   (required)
@mode? 'steer' | 'now'   (default 'steer')
@onSendNow?, @onEdit?
```

**The mode's meaning is rendered, not implied.** The component carries a `semantics` line explaining what each mode does — "Send now interrupts; Steer is delivered at the next checkpoint" — because the two modes have materially different consequences and a badge reading `steer` teaches nobody. That is the territory's colour-never-carries-state-alone law applied to a delivery guarantee.

**`steer` is the default**, and that is the safe default: interrupting a running agent discards partial work, and a user who has not thought about it should get the non-destructive behaviour.

`@onEdit` exists because a queued message is still editable — it has not been sent — and a queue with no edit is a queue you have to delete from.

## Prior art

This has essentially no precedent in component libraries, and only a thin one in products. The recognisable analogues are **email's "undo send" window**, **Slack's scheduled-send**, and the general messaging-queue pattern of a message in a pending state.

What is genuinely novel is the **two delivery semantics as a first-class distinction**. Most agent composers have one behaviour — either your message interrupts, or it queues — and the user learns which by experiment. Naming both, defaulting to the safe one, and stating the difference in the UI is the right design for an interaction where getting it wrong costs the agent's current work.

Where it is thin:

- **No queue.** This is one message; the ordering, count and "3 messages queued" summary are the caller's.
- **No delivery confirmation.** The component shows a message as queued and has no state for "delivered".
- **No cancel.** `@onEdit` implies editing; there is no `@onDiscard`.
- **No checkpoint indication.** `steer` promises delivery "at the next checkpoint" and nothing shows when that will be, so the promise is unfalsifiable from the UI.

## Accessibility

No pattern governs it. The relevant criteria are WCAG **4.1.3 Status Messages**, **3.3.2 Labels or Instructions** and **3.3.4 Error Prevention**.

What is right: **the semantics line is text.** The consequence of each mode is available to everyone, not encoded in a badge colour — which satisfies **3.3.2** for an interaction whose consequences are not obvious.

Gaps:

- **The message's queued state is not announced.** A user types, presses Enter, and the message moves into a pending state — a status change (**4.1.3**) with no live region. For a screen-reader user the message simply is not sent, with no explanation, which is the worst possible reading of the interaction. A `role="status"` region saying "Queued — will be delivered at the next checkpoint" is close to mandatory here.
- **Delivery is not announced either.** When the checkpoint arrives and the message goes, nothing says so.
- **"Send now" is a consequential action with no confirmation.** It interrupts a running agent and discards partial work; **WCAG 3.3.4** asks for confirmation or reversibility for actions with significant consequences. Nothing here confirms, and the button sits directly beside "Edit".
- **The mode is not a control.** `@mode` is an arg the caller sets, so a user cannot switch a queued message from steer to now except through `@onSendNow`, which is a different action. That is a coherent design, but it means the displayed mode reads like a toggle and is not one — verify it is not marked up as one.
- **`@text` may be long** and there is no expressed truncation or expansion behaviour; a queued paragraph should not be silently clipped.
- **Button labels are generic.** "Send now" and "Edit" outside their context do not name the message; `aria-describedby` pointing at the text would help on a screen with several queued messages.

## Theming

`--inset` or `--card` (the pending surface — a queued message should read as *not yet* part of the transcript), `--border`, `--muted-foreground` (the semantics line), `--foreground` (the message text), plus **Button** tokens for the two actions and the mode's own dress.

The visual distinction that matters is **pending versus sent**. A queued message must not look like a transcript row, or the user will believe it has gone. A season should give it a distinct surface, a dashed edge, or reduced weight — and should check that the distinction survives in dark mode, where the usual "slightly lighter grey" solution collapses.

The styles sit in `@layer PretComposite`, above Button's `PretComponent` layer, so what this component sets on Button wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
