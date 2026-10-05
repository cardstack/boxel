# Film Handles, Playback, and Exact Rendering

The Film handle exposes the operations a poster, chapter menu, or rendering tool needs without giving it ownership of the internal animation loops. The most important distinction is between an interactive navigation operation and a deterministic frame request. They can arrive at a similar visible moment while honoring different contracts.

## Opening and Navigating

`FilmHandle` reports the current beat, chapter, ready state, and formatted runtime. `begin(withSound)` opens playback with the selected audio policy. `cutTo(index)` navigates to a beat, `restart()` starts again, `toc()` opens chapter navigation, and `preview(join)` demonstrates a seam over the current picture.

```ts title="Component logic excerpt"
import type { FilmHandle } from '@cardstack/choreo/film';

async function capture(handle: FilmHandle, frame: number) {
  await handle.renderAt(frame / 60);
  // The capture tool records after this barrier resolves.
}
```

Use the readiness signal before presenting an action that requires a seated picture. A graph can compile successfully while the iframe or model still needs time to initialize. The handle represents that distinction to the surrounding interface.

## Choosing the Seek Model

Film's `@seek='cut'` mode supports a live camera chase. Skipping re-cuts the score from a suitable point rather than claiming that a stateful spring has no history. `@seek='exact'` uses the clock as the source of visual state and is appropriate for random-access inspection and deterministic export.

`seek(seconds)` is a viewer-facing operation. A seek into a transition can land on the incoming shot according to the interactive policy. `renderAt(seconds)` is the export operation: it reconstructs the requested frame, including the relevant composition work, and waits for its rendering barrier. Do not use a series of UI scrubs as a substitute for a frame renderer.

## Keeping One Owner

A capture tool should not simultaneously play the film and assign its time. Pause or use the handle's controlled render path, then sample each frame at the target interval. If the picture adapter adds its own camera smoothing, it must honor exact pose requests or the same requested time can produce different pixels.

Test a cold request in the middle of the film, repeated requests for the same time, and backward requests across a cut. Also test ordinary playback separately, because exact rendering does not prove the sound-start gesture works in Safari. Reliable delivery requires both a correct temporal model and a host that reports when its actual pixels and media are ready.

## API Coverage

**@cardstack/choreo/film**: `FilmHandle`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts).
