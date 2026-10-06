# Driving an External Clock

`choreo-player` lets a transport or recorder tell a Choreo run which time to show. The unit is seconds, and seeking is absolute: asking for 4.25 seconds means showing that moment rather than advancing by 4.25 seconds.

## Creating a Player

Install the transport in the application that owns the scene.

```sh title="Terminal"
pnpm add @cardstack/choreo-player
```

The player needs a function that returns the runs it controls. This function is read again for each operation, which allows a new render pass to replace a run.

```ts title="A Player for an Existing Run"
import { createChoreoPlayer, type ChoreoRun } from '@cardstack/choreo-player';

export function playerFor(currentRun: () => ChoreoRun | undefined) {
  return createChoreoPlayer({
    duration: 12,
    runs: () => {
      const run = currentRun();
      return run ? [run] : [];
    },
  });
}
```

Pass a getter for the scene's current public run. A Choreo run exposes `duration`, `time`, `speed`, `play()`, and `pause()`, which are the capabilities the player uses.

## Rendering a Moment

Once the scene is ready, await `renderAt` before capturing its output.

```ts title="Controlling the Prepared Player — Excerpt"
await player.renderAt(4.25);
await player.play();
player.pause();
```

If the score is mounted only for recording, use the player's `prepare` callback to mount it on the first external operation. Keep ownership explicit so the player cannot pause an unrelated interactive scene.

## Reconstructing Application State

Seeking the motion run alone cannot reopen a panel that application state has removed. A recordable host also needs to derive its state from the events at or before the requested time.

For each frame, prepare the owned score, apply the state for that time, await the Glimmer render, and reassert the run's time before capture. The exact render barrier belongs to the host application.

Test by seeking forward and backward in a nonsequential order. If the same timestamp produces different content, some state is still depending on playback history. See the [recording contract](https://github.com/cardstack/choreo/blob/main/docs/demo-recording.md) for the complete lifecycle.

## Selecting the Appropriate Transport

Use the standalone player when the application owns a few runs and needs explicit playback or capture controls. Use Film when the composition also owns shots, picture capabilities, joins, narration, and presentation furniture. Neither choice should discover every active animation in the document. The dedicated player and attachment guides explain preparation, replacement, synchronization, settlement, and exactness so one embedded demonstration cannot accidentally take control of another.
