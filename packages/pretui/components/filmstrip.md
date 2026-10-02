## What it is

A thumbnail strip along a timeline: N frames in time order, a playhead, and a scrub gesture that is one keyboard control rather than N.

Use it to preview and seek a video — beside a **MediaPlayer**, or as the scrub surface of an editor. For audio, the equivalent is **Waveform**; for choosing a range rather than a point, **TrimBar**.

## The contract

```
@frames (required) — {time, src, label?}[] in time order
@label (required)  — accessible name of the scrubber
@duration?         — length of the time axis in seconds; defaults to the last frame's time
@current?          — playhead position in seconds; uncontrolled when omitted
@thumbWidth?       — tile width in px. Default 96
@ratio?            — tile aspect ratio. Default '16 / 9'
@showTimes?        — show the time under each tile. Default true
@onScrub?          — fires on every scrub, keyboard or pointer

<:empty> — replaces the built-in empty state
```

**Build the even case with `evenFrames(duration, count, src, label)`** rather than writing the loop again. It is deterministic, which matters here: the same strip survives a reindex instead of being regenerated differently each time.

**`@duration` defaults to the last frame's time**, so a strip that ends at its last thumbnail needs no explicit axis.

**A strip with no frames says so** rather than rendering an empty rail — and `<:empty>` replaces that message.

**`frameAt` finds the last frame at or before a time**, which is the rule that makes an irregular strip behave: frames need not be evenly spaced, and the one showing is the most recent one to have started.

## Prior art

A kit addition. The comparison is against the scrub strip in a video editor, and the thing those get wrong at the component level: a row of clickable thumbnails is N tab stops and N controls, so tabbing through a strip of forty frames means forty stops before reaching anything else on the page.

Where Pretui is better: **the strip is one tab stop over N frames.** The tiles are inert and the scrubber is a single slider over the time axis, which is both the correct keyboard model and the correct mental model — you are moving a playhead, not choosing from a list.

Where it is thinner: no zoom into the timeline, no frame extraction — the frames are the caller's to produce — no markers or chapter boundaries drawn on the axis, and no lazy window, so a long strip renders every tile. It also does not connect itself to a player; wiring `@onScrub` to a **MediaPlayer** is the caller's job, and there is no shared playhead contract between the two.

## Accessibility

- **One tab stop over the whole strip.** The tiles are interactive to the pointer but carry `tabindex='-1'`, because twelve tab stops in a scrub strip is a keyboard trap by volume rather than by design.
- **The scrubber is a `role='slider'`** over the time axis with `aria-label` from `@label`, `aria-valuemin` of 0, `aria-valuemax` of the duration, and a live `aria-valuenow`.
- **`aria-valuetext` is a clock reading**, not a float — the same rule **Waveform** follows, for the same reason.
- **The slider's overlay is deliberately empty**, because `role='slider'` takes presentational children; the tiles sit beside it in the layer order rather than inside it.
- **The empty state is text**, so a strip with no frames is explicable rather than being a blank band.
- **`@showTimes={{false}}` removes the visible times only.** The position stays announced through the slider's value text.

## Theming

`--pretui-strip-w` (tile width, from `@thumbWidth`) and `--pretui-strip-ratio` (tile aspect, from `@ratio`), both written through the kit's CSS guard so a bad ratio drops its declaration rather than landing half-formed. Plus `--pretui-primary-ink` for the playhead and `--pretui-shadow-hairline` for tile edges.

The two geometry tokens are per-instance rather than seasonal because a strip's density is a function of the footage and the space, not of the theme. The playhead colour is the season's primary, which is what makes a strip read as part of the same product as the player above it.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
