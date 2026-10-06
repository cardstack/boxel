## What it is

An audio waveform you can operate: the drawing, a transport, a readout, and a scrubber that is a real slider rather than a canvas you can only click at.

Use it when the shape of the audio matters — reviewing a recording, finding a moment, checking levels. When it does not, **AudioPlayer** is the smaller component. For selecting an in/out range over audio, **TrimBar** is the one built on the same engine.

## The contract

```
@src (required)   — URL of the audio; passed through untouched
@label (required) — accessible name of the scrubber
@height?          — drawing height in px. Default 96
@barWidth?        — bar width in px, or 0 for a continuous waveform. Default 3
@barGap?          — gap between bars in px. Default 2
@normalize?       — scale peaks to the loudest sample. Default true
@step?            — seconds moved by one arrow press. Default 1
@bare?            — hide the transport row and the readout, leaving only the wave
@onReady?         — fires with the duration
@onSeek?          — fires with the new position in seconds
@onPlayingChange? — fires when playback starts or stops
```

**`@src` is passed through untouched.** The component never creates or revokes an object URL, so a blob URL stays the caller's to revoke.

**`@label` is required in practice, and the type says so.** A `slider` with no name is the single most common failure in this category.

**The height is reserved before the audio lands**, so nothing reflows when the decode finishes.

**Failure is a state, not a crash.** Construction is wrapped, and `phase` — `idle → loading → ready`, or `error` — is part of the public contract, so a caller and a test can both assert on what happened without asserting that a decode succeeded. That matters more than it sounds: a headless browser has no real media pipeline, so `error` is the *expected* outcome in the test harness.

**`@bare` drops the transport and the readout but keeps the scrubber.** The keyboard path is never what gets removed.

## Prior art

**WaveSurfer.js** (BSD-3) does the drawing and the decode, owned by a modifier so its lifecycle is tied to the element rather than to a module.

Where Pretui is better, and it is the whole reason this component exists: **wavesurfer gives pointer seeking and nothing else** — no tab stop, no arrow keys, no announced position. Every wavesurfer example on the web is `WaveSurfer.create({container: '#waveform'})` with a play button and no keyboard path at all. Here the wave is a `role='slider'` with one tab stop, ←/→ by `@step`, Shift for a coarse step, PageUp/PageDown, Home/End, Space to play, and an `aria-valuetext` that says "0:03 of 0:06".

Where it is thinner: no regions or markers exposed as a contract (the plugin is loaded, but **TrimBar** is the component that surfaces it), no zoom into the timeline, no multi-channel or spectrogram view, no peak pre-computation — every instance decodes the file itself, which is fine for one and expensive for a list.

## Accessibility

- **The scrubber is a `role='slider'` with a name, a value and a phase.** `aria-valuemin` is 0, `aria-valuemax` is the duration once known, `aria-valuenow` is the playhead.
- **`aria-valuetext` reads "0:03 of 0:06" rather than a float.** A bare `aria-valuenow` of `3.417` is technically correct and useless.
- **The scrubber is `aria-disabled` until the audio is ready**, so a reader is not handed a control over something that has not decoded.
- **The overlay carrying the slider role is deliberately empty**, because `role='slider'` takes presentational children — anything inside it would be hidden from assistive technology, so the visual layers sit beside it rather than within it.
- **The play button is a toggle with `aria-pressed`**, and its glyph is `aria-hidden` so the state comes from the attribute rather than from a symbol.
- **The error state carries a hidden warning glyph and visible text**, so a failed decode is readable rather than being an empty box.

## Theming

`--pretui-wave-height` (the reserved drawing height), `--pretui-primary-ink` (the played portion and the transport), `--pretui-destructive-ink` (the error state), `--pretui-shadow-hairline`.

The bar geometry is args rather than tokens, deliberately: `@barWidth` and `@barGap` change what the waveform *is* at a given zoom rather than how the season dresses it, and two waveforms in one product may legitimately want different densities. The colours are tokens, so a season recolours every wave at once and a played/unplayed split always matches the product's primary.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
