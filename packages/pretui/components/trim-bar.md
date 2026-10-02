## What it is

An in/out selection over a time-based source: two handles on a waveform, with the region between them shaded, and neither handle able to cross the other.

Use it wherever a range of audio is being chosen — a clip, an excerpt, a loop. For playback rather than selection, that is **Waveform**; for a video timeline, **Filmstrip**.

## The contract

```
@src (required)   — URL of the audio to trim over
@label (required) — accessible name; each handle derives its own from it
@start?, @end?    — in and out points in seconds; uncontrolled when omitted
@minGap?          — smallest gap the handles may leave, in seconds. Default 0.1
@step?            — seconds moved by one arrow press. Default 0.1
@height?          — drawing height in px. Default 72
@onChange?        — fires continuously while dragging and on every key press
@onCommit?        — fires once when a pointer drag ends
```

**`@onChange` and `@onCommit` are different events for different consumers.** Change fires continuously — use it to drive a live preview. Commit fires once at the end of a pointer drag — use it to persist. A keyboard interaction has no drag to end, so it fires change only.

**The handles cannot cross**, and `@minGap` is the floor between them rather than merely a zero check. A trimmer whose handles can swap produces a negative range that every downstream consumer has to defend against.

**Both ends are uncontrolled when omitted**, so the component is usable with no state wiring at all and controllable when you need it.

## Prior art

**WaveSurfer's regions plugin** draws the selection and holds the range, over the same engine **Waveform** uses.

Where Pretui is better, and this is the entire design decision: **the plugin's own handles are pointer-only divs inside wavesurfer's shadow root** — unreachable by keyboard and unstylable from outside. So the region is created with `drag: false, resize: false`, and the two handles are real focusable elements in the light DOM, each a `role='slider'` with its own min, max and value. One visual, one interaction model. The upstream trimmer examples are a draggable region with no announced value, which is unusable without a mouse.

Where it is thinner: one region only — no multi-region editing, no named regions, no snapping to markers or to zero-crossings, and no zoom into the timeline, so trimming to a tenth of a second on a long file is a lot of arrow presses. There is no waveform-free mode either: the component always draws audio, so trimming over a video track means trimming over its audio.

## Accessibility

- **Two named handles, each a real slider.** Each derives its own accessible name from `@label`, so they are distinguishable rather than being "slider" twice.
- **Each handle carries its own min, max and value**, and the constraint between them is expressed in those bounds — the in-point's maximum moves with the out-point. That is what makes "cannot cross" perceivable rather than merely enforced.
- **The shading is `aria-hidden`.** The selected region is conveyed by the handles' values, not by a visual band alone.
- **Arrow keys move by `@step`**, so precision is reachable without a pointer.
- **`@minGap` is expressed through the handles' bounds**, which means a screen-reader user hits the limit as a value that stops moving rather than as a silently rejected input.

## Theming

`--pretui-trim-in` and `--pretui-trim-out` (the two handles), `--pretui-wave-height` (shared with **Waveform**, so a trimmer and a player are the same height in a season), `--pretui-primary-ink`, `--pretui-destructive-ink` for the error state, `--pretui-shadow-hairline`.

Giving the two handles separate tokens is deliberate: in and out are different things, and a season that wants them to read as a pair sets both to the same value, while one that wants direction to be visible does not. Sharing `--pretui-wave-height` with Waveform is the other half — a trimmer under a player should line up with it without either component knowing about the other.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
