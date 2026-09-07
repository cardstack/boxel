# Render Your First MP4

This tutorial turns a six-second Choreo scene into a playable MP4 with a short audio cue track. It includes the application, a render barrier, frame capture, encoding, and output checks. The small scene uses choreo-player directly. It does not require Film's chapter and picture system; add those constructs when your edit needs them.

## Run the recordable scene

Use the starter from [Build Your First Choreo Application](/docs/core-first-app), then open http://localhost:4600/film. The orange circle moves, holds, changes scale, and returns. Play starts the scene; the seek slider requests a specific time. The full component is app/components/recordable-scene.gts.

The score is six seconds long. Position and scale arrays share normalized times, so the hold occupies the same part of both tracks. Nothing is added or removed during this scene. That makes every requested frame reconstructible without replaying application actions. A larger film that opens panels or changes text must reconstruct those semantic states too.

## Establish clock ownership

The player prepares the scene only when Play or renderAt is first called. Preparation sets armed, causing a render pass that compiles the score. A modifier retains the scene context. Preparation waits until its live run getter publishes the compiled score; the player then pauses and seeks that run. This is important because an initial Choreo render does not automatically produce the later changeset you need to record.

```ts title="RecordableScene — player excerpt"
private player = createChoreoPlayer({
  duration: 6,
  prepare: async () => {
    this.armed = true;
    while (!this.context?.run) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  },
  runs: () => this.context?.run ? [this.context.run] : [],
});
```

The complete source bounds this readiness wait and stops waiting after teardown. The wait observes run publication; it does not schedule individual animation steps.

After preparation, renderAt asks the owned run for its time and awaits the player's default browser-frame barrier. That barrier is sufficient for this DOM-only example. An asynchronously rendered canvas, image, model, or video needs its own readiness contract; two browser frames are not proof that an external renderer finished loading or drawing.

The component exposes a small tutorialCapture object on its frame element. The recorder calls that object rather than reaching into Ember's container or private Choreo internals. The modifier removes the handle and pauses the player when the component is destroyed.

## Capture and encode

Install FFmpeg and make ffmpeg and ffprobe available on PATH. The recorder uses the existing Playwright dependency in the Boxel gallery tooling package. If Chromium is not installed, run pnpm --filter choreo-gallery exec playwright install chromium. Keep the starter server running, then run from the repository root:

```sh title="Terminal"
node packages/choreo-gallery/scripts/record-tutorial.mjs   http://localhost:4600/film /tmp/choreo-first-film
```

The output directory must not already exist. The script captures 360 PNG frames at 1920 by 1080: frame n requests n / 60 seconds. It awaits renderAt before each screenshot. Slow rendering makes the job take longer, but does not change the film's timing. The last delivered sample is 359 / 60; the six-second endpoint is checked separately by the regression test rather than duplicated into the movie.

The script then encodes H.264 with yuv420p pixels and adds an AAC cue track. Three short tones mark one, three, and five seconds. They are intentionally simple audio assets generated locally by FFmpeg, not narration and not audio secretly captured from a browser. faststart places MP4 metadata before the media data for progressive playback. The script probes the result and checks dimensions, frame rate, duration, and the audio stream.

## Verify before sharing

The script creates preview.mp4, cue.wav, and a frames directory. Open preview.mp4 in your target player and listen for the cues while watching the motion. Do not judge only the interactive page: the browser demo and the encoded delivery have different failure modes. Check the first and last frames, and look for changes at keyframe boundaries.

Run the starter verification script from the first tutorial as well. It captures the same scene time after forward and backward seeks and compares the pixels. The comparison catches history-dependent motion that a successful encode cannot detect. Passing Chromium checks does not establish Safari audio-start or host byte-range behavior; check the deployed media in the browser you intend to support.

## Add a larger edit

For narration, replace the generated cue track with approved audio and align its clip offsets to the same score. Keep browser autoplay permission separate from offline audio mixing. For chapters, picture renderers, and joins, continue with [Building a Film](/docs/film-shots) and [Picture readiness](/docs/film-picture). This tutorial demonstrates the complete smallest recording pipeline so those additions have a working baseline.

The complete sources are [recordable-scene.gts](https://github.com/cardstack/choreo/blob/main/test-app/app/components/tutorials/recordable-scene.gts) and [record-tutorial.mjs](https://github.com/cardstack/choreo/blob/main/packages/choreo-gallery/scripts/record-tutorial.mjs). Keep output media outside tracked source files unless you intentionally want to distribute an example recording.
