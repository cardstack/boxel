# @cardstack/choreo-player

A dependency-free, headless transport for externally clocking public Choreo
runs. It builds around `@cardstack/choreo`; it does not patch Choreo, emulate a
GSAP timeline, or bundle a renderer.

## Install

```bash
pnpm add @cardstack/choreo-player
```

Releases go out under two dist-tags: `unstable`, published as changes land, and
`latest`, cut deliberately from one of those prereleases.
`pnpm add @cardstack/choreo-player@unstable` follows the former.

Your application supplies the `@cardstack/choreo` version that yields the runs.
The player uses a structural five-member run contract and has no runtime
dependency on either `@cardstack/choreo` or HyperFrames.

## Own and control runs explicitly

```ts
import { createChoreoPlayer } from '@cardstack/choreo-player';

let scoreRun = null;

const player = createChoreoPlayer({
  duration: 12,
  // Called once, when an external clock first arrives. A Glimmer host can use
  // this to mount the scored pass before the first capture worker seeks.
  prepare: () => mountScore(),
  // Read again for every operation. Never return a demo's interactive run
  // until the external recorder has armed ownership of it.
  runs: () => (scoreRun ? [scoreRun] : []),
});

await player.renderAt(4.25);
await player.play();
player.pause();
```

The run type is deliberately structural:

```ts
interface ChoreoRun {
  readonly duration: number;
  time: number;
  speed: number;
  play(): void;
  pause(): void;
}
```

`renderAt()` pauses every owned run, sets speed and absolute time, and waits
for the configured host settlement. Its requests are latest-wins while an
asynchronous `prepare()` is pending. `sync()` applies the current transport
state after Glimmer replaces a run.

## Reconstruct application state

The player owns Choreo time, not application state. A recordable Glimmer demo
usually wraps it in a transaction that reconstructs state from the requested
time and waits for the resulting render:

```ts
async function renderFrameAt(time) {
  // Make the score exist and let it expose any compiled cue times.
  await player.renderAt(time, { settle: false });

  state = foldEventsThrough(time);
  await glimmerRenderFinished();

  // Reassert the computed still on the final DOM that will be captured.
  await player.renderAt(time, { settle: false });
  paintImperativeReadouts(time);
}
```

The exact state fold and Glimmer render barrier belong to the application;
the package cannot infer them safely. See `docs/demo-recording.md` in the
Choreo repository for the complete ownership and determinism checklist.

## HyperFrames

HyperFrames is optional and is not installed by this package. Install a pinned
CLI version in the video project that performs the rendering:

```bash
pnpm add --save-dev hyperframes@0.8.14
```

Bind the application's complete frame transaction to HyperFrames' native
awaited seek event:

```ts
import { bindHyperframes } from '@cardstack/choreo-player/hyperframes';

const disconnect = bindHyperframes({
  renderAt: renderFrameAt,
});
```

`bindHyperframes()` forwards `event.detail.time`, registers the returned
promise with `event.detail.waitUntil()`, propagates failures to the capture
barrier, and returns an event-listener cleanup function. It does not import
HyperFrames or inspect the DOM.

Parallel safety is a property of `renderFrameAt()`, not a promise made by this
package. The reference Playhead fixture is verified with both one and ten
workers and scanned for opening-frame flashes at every worker boundary.
