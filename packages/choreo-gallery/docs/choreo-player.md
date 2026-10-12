# Shipping `choreo-player` 1.0

`choreo-player` is the small boundary between a public Choreo run and an
external clock. It lets preview tools and deterministic renderers control
Choreo without changing `glimmer-motion` or Choreo core.

## Package boundary

The npm package has two exports:

- `choreo-player` — dependency-free play, pause, absolute render, rate, and
  replacement-run synchronization;
- `choreo-player/hyperframes` — a dependency-free binding to HyperFrames'
  native `hf-seek`/`waitUntil()` browser protocol.

It does not ship UI, demo state reducers, DOM discovery, generated media, a
GSAP facade, or HyperFrames itself.

The player accepts a structural run instead of importing the
`glimmer-motion` runtime:

```ts
interface ChoreoRun {
  readonly duration: number;
  time: number;
  speed: number;
  play(): void;
  pause(): void;
}
```

That is the complete surface it uses. A public `ChoreoRun` yielded by
`<Choreo>` satisfies the interface without an adapter.

## Explicit ownership

Every player requires a `runs()` provider:

```ts
const player = createChoreoPlayer({
  duration: 7,
  prepare: () => {
    recording = true;
    mountScoredPass();
  },
  runs: () => (recording && scoreRun === currentRun ? [scoreRun] : []),
});
```

This is intentionally not a global registry. A recorder must not touch an
interactive run merely because both exist on the same page. The external
clock arms ownership through `prepare()` on its first call and retains it for
the page's recording session.

Read [demo-recording.md](demo-recording.md) before making a demo recordable.
Its interactive-test requirement is part of the release contract.

## A frame is an application transaction

`player.renderAt(t)` controls Choreo runs. The application still owns the
tracked state that decides what Glimmer renders. A complete recording method
therefore reconstructs both:

```ts
async function renderAt(time: number) {
  await player.renderAt(time, { settle: false });

  state = foldEventsThrough(time);
  await glimmerRenderFinished();

  await player.renderAt(time, { settle: false });
  paintImperativeReadouts(time);
}
```

The first seek makes a newly mounted score and its compiled cues available.
The state fold makes the application a function of time. The awaited Glimmer
pass commits that state, and the final seek reasserts the Choreo still on the
DOM that will be captured.

## HyperFrames is optional

Applications that only need an external transport install `choreo-player`
alone:

```bash
pnpm add @cardstack/choreo-player
```

A video project installs its own exact HyperFrames CLI as a development tool:

```bash
pnpm add --save-dev hyperframes@0.8.14
```

The local scripts then use the pinned binary:

```json
{
  "scripts": {
    "preview": "hyperframes preview build",
    "check": "hyperframes check build",
    "render": "hyperframes render build --workers 10"
  }
}
```

Do not install HyperFrames globally, bundle it into `choreo-player`, declare it
as a peer dependency, or use an unpinned `npx --yes hyperframes` in a durable
composition.

Connect the complete application transaction to capture:

```ts
import { bindHyperframes } from '@cardstack/choreo-player/hyperframes';

const disconnect = bindHyperframes({ renderAt });
```

Parallel safety belongs to this `renderAt()` implementation. Ten workers are
a verified result for the Playhead fixture, not a package-wide guarantee.

## Reference proof

`videos/playhead-recording` is the installation and render fixture. It:

- builds the real Glimmer gallery application;
- copies the published-shape `choreo-player/hyperframes` module into the
  composition;
- mounts the real Playhead Glimmer component with no added border;
- binds native `hf-seek` to its awaited frame transaction;
- pins HyperFrames 0.8.14 locally; and
- renders 1920×1080, 30fps, with ten workers.

The proof was compared with a same-build one-worker render. FFmpeg measured
54.15 dB average PSNR and 0.999583 SSIM, and found no post-opening frame that
matched the opening frame at any worker boundary.

## 1.0 release gate

Before publishing:

1. Build and run the package contract tests.
2. Run `pnpm pack` and inspect the tarball contents.
3. Install the tarball in the reference fixture.
4. Run the complete interactive Ember suite.
5. Run HyperFrames check and render with one and ten workers.
6. Scan every worker boundary for an opening-frame insertion.

The npm artifact should contain only `dist`, `README.md`, `LICENSE`, and
`package.json`.
