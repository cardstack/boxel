## What it is

The audio skin over **MediaPlayer**: cover art, title and artist beside a compact transport laid out in normal flow rather than over a picture.

Like **VideoPlayer** it is a skin, not a rewrite — the transport, the transcript, the status line and the keyboard contract are all the base component's. Use it for a single track. There is no playlist here; a queue is the caller's to build around it.

## The contract

```
every MediaPlayer arg except kind, poster, placeholder, thumbnails and aspectRatio
@cover?    — cover art URL
@coverAlt? — alt text for the cover; empty by default, which marks it decorative
@title?    — track title
@artist?   — artist, show, or byline

<:art>      replaces the cover art entirely
<:meta>     replaces the title/artist stack
<:controls> forwarded to MediaPlayer's control bar
<:footer>   forwarded to MediaPlayer's footer
```

**Five of the base's args are omitted rather than ignored**: the kind is fixed to `'audio'`, and the poster, placeholder, thumbnails and aspect-ratio args have nothing to apply to when there is no picture. The type says so, so passing one is a compile error rather than a silent no-op.

**`@title` is the fallback accessible name.** The label resolves as `@label`, then `@title`, then the literal `'Audio'` — so a player with a title is never nameless, and a player with neither is named honestly rather than not at all.

**`@coverAlt` defaults to empty, marking the cover decorative.** That is right when the title beside it says the same thing, which is the common case; supply alt text only when the artwork carries meaning the text does not.

**The cover is lazy-loaded.**

## Prior art

The upstream here is **MediaPlayer** itself — this is a skin rather than a port. Media Chrome underneath ships an audio layout; what it does not ship is the metadata block, and the cover/title/artist arrangement is the thing every product rebuilds.

Where Pretui is better: the metadata stack is part of the component and replaceable through `<:art>` and `<:meta>`, so a caller who needs a different arrangement overrides a block instead of abandoning the component. And the transcript — genuinely more valuable for audio than for video, since there is no picture to read — comes from the base for free.

Where it is thinner: no playlist, no queue, no chapter list, no waveform. **Waveform** is a separate component and the two do not compose today, which is the most obvious missing pairing in this category.

## Accessibility

- **The player is named even when the caller forgets**, through the `@label` → `@title` → `'Audio'` chain. That is weaker than a real label and better than an unnamed region.
- **The cover is decorative by default.** An `alt` of empty string is a deliberate signal, not a missing attribute — it tells a screen reader to skip an image whose meaning is already in the title beside it. Overriding it matters when the artwork is the content.
- **Audio has no picture, so the transcript carries more weight here.** Everything that would be conveyed visually in a video is conveyed by the transcript in audio, and it is the one thing worth supplying if you supply nothing else.
- **The live region, the status line and the disclosure contract are MediaPlayer's**, unchanged.

## Theming

`--pretui-media-ink`, `--pretui-media-radius`, `--pretui-media-scrim`, `--pretui-destructive-ink`, `--pretui-shadow-card`, `--pretui-shadow-hairline` — all from **MediaPlayer**, which is the point: an audio player and a video player in the same season are visibly the same family.

The audio layout adds no tokens of its own. The cover size and the metadata stack's spacing are fixed, so a row of audio players aligns without per-instance tuning.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
