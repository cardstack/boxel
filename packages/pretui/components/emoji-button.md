## What it is

An emoji picker behind a trigger: a button that opens **EmojiPicker** in a popover and closes on selection.

Use it beside a text field — a composer, a comment box, a reaction control. When the picker lives in an already-open panel, use the picker directly.

## The contract

```
@onSelect?    — called with the chosen emoji; the popover closes on selection
@label?       — accessible name for the trigger. Default 'Insert emoji'
@placement?   — where the popover opens. Default 'bottom-start'
@skinTone?, @onSkinTone? — forwarded to the picker
@recent?, @onRecent?     — forwarded to the picker
@glyph?       — glyph painted on the trigger. Default a smiling face
```

**It closes on selection.** An emoji picker that stays open after a pick is for someone inserting several; beside a composer, one is the common case and staying open is in the way.

**Tone and recency pass straight through.** The button holds no state of its own — persisting them is still the caller's job, through the same callbacks, which is what keeps the choice sticky across every picker in the product rather than per trigger.

**`@placement` matters more here than for most popovers**, because a composer is usually at the bottom of a panel and a picker opening downward will be off-screen.

## Prior art

The emoji trigger every chat composer ships.

Where Pretui is better: nothing about the trigger itself — it is a thin wrapper, deliberately. The value is that tone and recency are the *picker's* contract passed through, so two triggers in the same product share one persisted state instead of each keeping its own.

Where it is thinner: no inline shortcode expansion (`:smile:`), no recent-emoji strip on the trigger itself, and no reaction-style multi-pick mode.

## Accessibility

- **The trigger is named** — "Insert emoji" by default — rather than being an unlabelled glyph button, which is what this control usually is.
- **The glyph is presentation**; the name carries the meaning.
- **The popover holds EmojiPicker**, so its search-first model and per-emoji names apply unchanged.
- **Closing on selection returns focus to the trigger**, which is the behaviour that lets someone insert an emoji and keep typing.
- **`@placement` is an accessibility concern as well as a layout one**: a popover that opens off-screen is unreachable by every input method equally.

## Theming

The trigger takes the kit's shared control tokens and the popover the shared overlay tokens; the picker inside carries its own, as documented on **EmojiPicker**.

There is deliberately no emoji-button-specific surface. The trigger should be indistinguishable from the other small controls in a composer's toolbar, and giving it a token of its own is how it ends up looking like a plug-in.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
