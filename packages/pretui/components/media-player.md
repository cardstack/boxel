## What it is

The transport: play, seek, volume, captions, playback rate, picture-in-picture, fullscreen, keyboard — over a real `<video>` or `<audio>` element. Audio and video come from the one contract, with `@kind` deciding whether the chrome lays out over a picture or in normal flow.

You rarely reach for it directly. **VideoPlayer** and **AudioPlayer** are skins over it, and **MediaViewer** routes to those by asset kind. Use this when you want the transport without either skin's framing — or with `@chrome='none'`, when you want to build the control bar yourself.

## The contract

```
@src?            — passed through untouched; the player never builds or revokes an object URL
@kind?           — 'video' (default) | 'audio'
@label?          — accessible name for the player region
@poster?         — poster image for video
@placeholder?    — tiny inline image painted under the poster while the poster loads
@aspectRatio?    — CSS aspect-ratio for the stage. Default '16 / 9'
@tracks?         — MediaTrackSpec[]: captions, subtitles, descriptions, chapters
@thumbnails?     — WebVTT thumbnails track; present ⇒ the scrubber previews while seeking
@transcript?     — TranscriptCue[], seekable
@transcriptOpen? — open the transcript on first paint. Default false
@captionsDefault?— turn on the first subtitles track unasked. Default false
@chrome?         — 'full' (default) | 'none', which renders an empty bar for <:controls>
@seekOffset?     — seconds for the skip buttons and ←/→. Default 10
@autoHide?       — let controls fade during playback. Default false
@loop?, @muted?  — both default false
@preload?        — 'none' | 'metadata' (default) | 'auto'
@crossOrigin?    — 'anonymous' | 'use-credentials'
@quietStatus?    — hide the status line. Default false
@onSnapshot?     — fires on every media event with the current snapshot

<:overlay>  floats over the picture, top-left
<:controls> appended inside the control bar, before fullscreen
<:footer>   under the transport, above the transcript
```

**`@src` is passed through untouched.** The player never builds or revokes an object URL, so a blob URL stays the caller's to revoke — the component cannot know when the caller is done with it.

**The stage reserves its aspect ratio from the first paint**, which is what stops the poster's arrival from reflowing the page around it. `@placeholder` exists for the gap before the poster itself resolves.

**There is no autoplay.** `@muted` is a starting state, not a licence to start.

**`@autoHide` defaults to false, inverting Media Chrome's own default.** Controls that vanish during playback are a discoverability cost the kit is not willing to pay by default. Focus always brings them back regardless.

**`@crossOrigin` is load-bearing for captions.** A cross-origin `<track>` file needs `'anonymous'` here or the browser drops it silently — no error, no captions button, nothing to debug.

**The transcript disclosure is uncontrolled with an override.** Internal state starts as "unset", which means `@transcriptOpen` still applies; once the reader touches the toggle, their choice wins and a caller flipping the arg no longer moves it.

**`timeupdate` is only subscribed when something on screen moves with the playhead** — that is, when there is a transcript. It costs a re-render four times a second, and paying it for a player with nothing to highlight would be waste.

## Prior art

Built on **Media Chrome** (MIT, web components): `<media-controller>` and its control-bar elements are doing the transport work, not a re-implementation. **Vidstack** is the reference for the video skin above it.

Where Pretui adds: the **seekable transcript** — neither upstream ships one, and it is the single most useful accessibility affordance a player can have, for readers who cannot use audio *and* for anyone who wants to find a moment without scrubbing. The **status line** is a text channel for buffering and error state rather than a spinner alone. `@autoHide` is inverted. And the reserved aspect ratio is enforced from first paint rather than being the caller's problem.

Where it is thinner: there is no playlist or queue model, no quality or track selector beyond captions, no chapters UI (chapters ride along for the browser and the scrubber but get no menu of their own), and no analytics or heartbeat hooks beyond `@onSnapshot`. Anything resembling adaptive streaming is entirely the browser's business here.

## Accessibility

This is the component where most of the accessibility budget went, and three decisions are worth knowing.

- **The live region says one thing, and says it rarely: a failure.** It is always present and empty until a load fails. Play, pause and seek are already announced by the transport buttons' own labels, and repeating them would be the "announces on every keystroke" failure — a region that narrates every interaction is a region users turn off.
- **The transcript is an APG disclosure rather than `<details>`/`<summary>`, and that is not a preference.** Realm lint's `no-nested-interactive` counts `<details>` as interactive and rejects any `<button>` inside it, cue buttons included. The platform element would have been the better answer — platform behaviour before a JS re-implementation — so since it is unavailable, the replacement carries the full contract instead: a real button, `aria-expanded`, `aria-controls`, and a region that stays in the DOM and hides with `hidden`, so the id `aria-controls` names always resolves.
- **The cue containing the playhead carries `aria-current`**, so a screen-reader user moving through the transcript can tell where playback is.
- **`@label` is strongly recommended and not enforced.** An unnamed player region is a dead end for someone moving by landmark, and nothing here will tell you that you forgot it.
- **The status glyph is `aria-hidden`**; the status text beside it carries the meaning, so buffering and error state are never conveyed by a symbol alone.
- **The disclosure id comes from a module counter**, not a random value or a timestamp — both are forbidden in this codebase, and neither is needed: the id has to be unique in a document, not unguessable.

## Theming

`--pretui-media-aspect` (the reserved stage ratio, written from `@aspectRatio`), `--pretui-media-radius`, `--pretui-media-ink` (the chrome's foreground), `--pretui-media-scrim` (the wash under the controls that keeps them legible over any frame), `--pretui-destructive-ink` (the error state), `--pretui-shadow-card`, `--pretui-shadow-hairline`.

The scrim is the token to watch across seasons: it is what guarantees the control bar stays readable over an arbitrary video frame, and a season that lightens it for aesthetics on a dark test clip will fail on a bright one. The kit's shared shadow tokens mean a player sits at the same elevation as the cards around it without a per-component value.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
