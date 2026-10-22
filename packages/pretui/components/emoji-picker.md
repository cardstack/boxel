## What it is

A searchable emoji grid with skin-tone selection and a recently-used row.

**EmojiButton** is this behind a trigger. Use the picker directly when it lives in a panel that is already open.

## The contract

```
@onSelect?      — called with the chosen emoji. The only required arg in practice
@skinTone?      — active skin tone 0-5. Controlled when supplied
@onSkinTone?    — called when the tone changes; persist it to make the choice sticky
@recent?        — recently-used emoji, MOST RECENT FIRST, as untoned unicode strings
@onRecent?      — receives the new recent list after each pick. Persist it verbatim
@recentLimit?   — how many recent emoji to keep. Default 18
@columns?       — columns in the grid. Default 9
@autofocus?     — focus the search field on insert. Default false
@emojiVersion?  — pin the emoji version instead of detecting it
@label?         — accessible name for the whole picker. Default 'Emoji picker'
```

**Recency is positional and carries no timestamp.** `Date.now()` is forbidden in realm code because it breaks indexing determinism — and a wall clock was never needed, because "most recent" is "index 0". The list is handed back whole for the caller to persist verbatim.

**Version detection draws fourteen 1×1 canvases** to work out which emoji the platform can actually render. `@emojiVersion` pins it, which is worth doing when a caller has already measured, or to make a screenshot test deterministic across machines.

**Skin tone is controlled when supplied**, and persisting it through `@onSkinTone` is what makes the choice sticky — a picker that forgets someone's tone on every open is a small, repeated insult.

**`@autofocus` defaults to false.** A picker that steals focus on insert is wrong in a panel and right in a popover, so the decision belongs to whoever placed it.

## Prior art

The emoji-picker component every chat product ships.

Where Pretui is better: recency without a clock, and version detection rather than assuming the platform's emoji font covers what the data claims — the failure being a grid of tofu boxes for anything newer than the OS.

Where it is thinner: no custom or uploaded emoji, no per-server emoji sets, no frequently-used ranking (recency only), and no category jump list beyond the grid's own ordering.

## Accessibility

- **The picker is a named region**, defaulting to "Emoji picker".
- **Search is the primary path**, and it is text — which makes the whole grid reachable by name rather than by hunting a visual grid.
- **Every emoji has a name.** A grid of glyphs with no accessible names is unusable, and emoji names are the one case where the visual and the accessible representation genuinely differ.
- **Skin tone is a real control**, not a long-press gesture, so it is reachable by keyboard.
- **`@autofocus` moving focus into the search field is right in a popover and wrong in a panel** — placing focus without the reader asking is disorienting when the picker was already on screen.
- **Version detection prevents the worst failure**: offering an emoji that renders as a tofu box conveys nothing to anyone and is undetectable to a screen-reader user, who will be told a name for a character that shows as a blank.

## Theming

`--pretui-palette-columns` governs the grid rhythm alongside the other palette surfaces in the kit; everything else — the search field, the tone control, the surface — comes from the shared control and overlay tokens.

A picker that themed independently would be conspicuous, because it is usually the only dense grid on a screen otherwise made of rows and fields.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
