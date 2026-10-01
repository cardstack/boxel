# The Standalone Choreo Player

`choreo-player` is a small headless transport for one or more explicitly owned Choreo runs. Use it when an application needs playback and frame sampling without the complete Film composition, picture adapter, menus, or narration system. Its narrow contract is useful for a demo recorder or an application-specific timeline inspector.

## Providing the Runs

`createChoreoPlayer()` accepts a `runs` function. The function is called again for operations so a newly compiled or replaced run can become the current owner. An optional duration can be a number or a function; otherwise the player uses the longest owned run.

```ts title="Component logic excerpt"
import { createChoreoPlayer } from 'choreo-player';

const player = createChoreoPlayer({
  runs: () => (currentRun ? [currentRun] : []),
  prepare: () => mountScene(),
  settle: () => waitForPicture(),
});

await player.renderAt(1.5);
```

Here `currentRun`, `mountScene`, and `waitForPicture` are host-owned values and functions. They must refer to this composition, not every active run in the document. The player does not discover arbitrary application animations or infer their readiness.

## Preparation and Settlement

`prepare` is a one-time asynchronous hook for mounting or compiling the externally driven scene. Failed preparation can be retried. `settle` supplies the host's rendering barrier; the default waits through two browser frames, which is adequate for some DOM work but not proof that a model or video frame has decoded.

`renderAt(time)` pauses the owned runs, applies the time and playback rate, then awaits settlement. A newer render request supersedes an older pending preparation result. The `settle:false` option is for a caller that supplies a stronger barrier itself, not for skipping readiness to make an export seem faster.

## Playback and Replacement

The player exposes play, pause, current time, duration, isPlaying, playbackRate, and setPlaybackRate. `sync()` applies the current transport state after a newly mounted run becomes available. That is the important operation when a scene recompiles while the inspector remains open.

The player is not a universal renderer for arbitrary stateful simulations. A run contract that exposes time does not magically make an external canvas, audio element, or physics loop deterministic. The host must connect those parts to its controlled clock and readiness boundary.

Test pause during asynchronous preparation, a replacement run followed by sync, and repeated renderAt requests in different orders. Verify that a separate demo elsewhere on the page keeps its own transport. Explicit ownership is what makes a small player safe to embed alongside other live examples.

## API Coverage

**choreo-player**: `ChoreoRun`, `ChoreoPlayer`, `ChoreoPlayerUpdateOptions`, `ChoreoPlayerOptions`, `createChoreoPlayer`.

Read the implementation: [`index.ts`](https://github.com/cardstack/choreo/blob/main/packages/choreo-player/src/index.ts).
