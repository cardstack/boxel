## What it is

The "jump to latest" chip: a floating control that appears when the reader has scrolled away from the live end of a transcript, and counts what arrived while they were gone.

## The contract

```
@visible?   — whether the chip is offered at all
@count?     — items that arrived while the reader was away. Non-zero switches the
              chip to its "new message" voice and shows the count
@label?     — override the derived label entirely
@direction? — which way the jump goes. Default 'down'
@onJump?    — fires when the reader takes the jump
```

**`@count` changes the chip's voice, not just its text.** Zero means "you have scrolled up"; non-zero means "things happened" — two different reasons to jump, and conflating them makes the chip either alarming or invisible.

**The chip does not decide when to show itself.** `@visible` is the caller's, because whether the reader is "away" depends on a scroll position the transcript owns.

**`@direction` exists because a transcript is not always bottom-anchored.**

## Prior art

The jump-to-latest affordance in every chat product.

Where Pretui is better: not much — this is a small component and the value is in it being one component rather than a bespoke floating div per surface. The count-versus-no-count voice split is the one design decision worth keeping.

Where it is thinner: no auto-hide on reaching the end (the caller flips `@visible`), no unread marker in the transcript itself, and no per-kind counting — "3 new" rather than "2 messages, 1 tool call".

## Accessibility

- **It is a real button**, reachable by keyboard, which matters more than it sounds: a floating pointer-only affordance leaves a keyboard user with no way back to the live end except scrolling.
- **The label carries the count** when there is one, so the reason to jump is in the accessible name rather than in a badge.
- **The glyph is `aria-hidden` with `focusable='false'`.**
- **Appearing is not announced.** The chip arriving is not news worth interrupting a reader for — it is an affordance they will find when they want it.
- **`@label` overrides the derived text entirely**, which is the escape hatch for a surface where "jump to latest" is the wrong phrase.

## Theming

The chip takes the kit's shared control and elevation tokens, floating at the raised layer.

There is no jump-chip-specific surface, which keeps it reading as a control belonging to the transcript rather than as an overlay on top of it.
