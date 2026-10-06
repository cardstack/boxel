# Engine handoff: deterministic Choreo camera seeks under an external clock

## Why this matters

`choreo-player` must be able to render any requested frame independently. A
video renderer, scrubber, test harness, or other external clock cannot depend
on playing every earlier browser frame in order.

The feature-reel proof currently demonstrates that `ChoreoPlayer` sets the
correct run time, but Choreo does not always reconstruct the corresponding
camera pose. This is an engine transport bug, not a HyperFrames timing bug.

Do not solve this by turning Choreo into a GSAP-style imperative timeline.
The desired model remains object/scene-oriented: events produce runs, the
template declares their sequencing, and an external transport asks a run for
a deterministic still at time `t`.

## Observed failure

The reproduction is the private feature reel at:

- `test-app/app/components/feature-reel.gts`
- `test-app/app/templates/feature-reel.gts`
- `videos/choreo-sequence-reel/`

Its outer score originally had this shape:

```gts
<c.Sequence>
  <c.Camera @fit={{c.id "scene-a"}} @duration={{0.65}} />
  <c.Wait @of={{c.all}} @duration={{1.55}} />
  <c.Camera @fit={{c.id "scene-b"}} @duration={{0.8}} />
  <c.Wait @of={{c.all}} @duration={{0.9}} />
</c.Sequence>
```

When HyperFrames requests (for example) `t = 8.9`:

1. The `hf-seek` bridge calls `FeatureReel.renderAt(8.9)`.
2. `ChoreoPlayer.renderAt(8.9, { settle: false })` pauses the owned run and
   assigns `run.time = 8.9`.
3. Instrumentation confirms the run reports `time === 8.9` and
   `duration === 15` before the frame barrier resolves.
4. The encoded/snapshotted DOM still shows the first Lightbox camera pose.

The clock is correct while the picture is wrong.

## Root cause

The relevant implementation is `packages/choreo/src/run.ts`,
especially `ChoreoRun.seekTo()` and the camera branch in `evaluate()`.

For a camera track, `evaluate()` initializes its camera state only when the
requested time is inside that track's active window:

```ts
const inside = now >= t.start && (now < t.end || fill);

if (cue.camera) {
  if (inside && !t.started) {
    t.started = true;
    t.cameraFrom = { ...this.camera };
    // ...resolve aim...
  }
  // ...apply only a track that has started...
}
```

On a random-access seek directly into a later `Wait`, all earlier camera cues
are already past their windows but have never been started. They therefore do
not contribute their final state. The run's `master` clock advances correctly,
but its cumulative `camera`, `cameraAim`, track origins, and frame transform do
not get reconstructed.

The same flaw can affect a direct seek into a later camera cue: its
`cameraFrom` may be derived from the default/rest camera instead of the final
state of preceding camera cues.

This is distinct from gate behavior. Existing gate semantics should continue
to clamp a seek at the first unopened gate.

## Proof that this diagnosis is correct

As a temporary experiment, the feature reel replaces each `c.Wait` following
a camera move with another `c.Camera` aimed at the same target, spanning the
hold interval with a constant easing function:

```ts
const HOLD = () => 1;
```

```gts
<c.Camera @fit={{c.id "scene-b"}} @duration={{0.8}} />
<c.Camera
  @fit={{c.id "scene-b"}}
  @duration={{0.9}}
  @ease={{HOLD}}
/>
```

With an active camera cue at every requested time, packaged HyperFrames
snapshots correctly show Lightbox at 1.5s, Beacons at 5.1s, Build Order at
8.9s/10.8s, and the final logo at 14.5s. That is a diagnostic workaround,
not the desired authoring contract.

## Required engine behavior

Setting `run.time = t` must produce the same camera still as playing the same
run forward from zero to `t`, subject to normal deterministic easing and gate
rules.

In particular:

- A seek into a wait after a camera move must hold the completed camera pose.
- A seek into the middle of a later camera move must start from the final pose
  and aim of all preceding completed camera moves.
- Seeking backward must discard later camera state and reconstruct the pose
  from the score prefix up to the new time.
- Repeated seeks must be idempotent: `t`, another time, then `t` again yields
  the same transform.
- Random-access and monotonically increasing external-clock seeks must agree.
- `fit`, explicit `x/y/zoom`, `origin`, inherited aim, `margin`, and `steady`
  behavior must remain correct.
- A seek across an unopened gate must retain the existing clamp/park behavior.
- Live playback and interruption/carry behavior must not regress.

## Recommended implementation direction

Make camera evaluation a pure reconstruction from the score prefix for a
scrubbed still.

One viable shape is a camera-specific reconstruction pass during `seekTo()` or
at the beginning of `evaluate()` when the run is paused:

1. Start from the run's initial `camera` and `cameraAim`.
2. Visit camera tracks in timeline order up to the clamped master time.
3. For every completed camera track, fold its exact final camera and final aim
   into the accumulator.
4. For the camera track containing the requested time, establish
   `cameraFrom`/`aimFrom` from that accumulator, sample its eased progress, and
   apply the interpolated state.
5. If the requested time lies between camera tracks, apply the accumulator as
   the held pose.
6. Synchronize the relevant track bookkeeping (`started`, `passed`,
   `cameraFrom`, `aimFrom`, `aimTo`, `cameraP`, and any WAAPI camera animation)
   so that play-after-scrub and backward scrubs remain valid.

Avoid deriving the answer from the currently rendered CSS transform. The run
already owns the semantic camera state and must remain deterministic under
interruption, external rendering, and non-browser test transports.

If a broader refactor is undesirable, a smaller helper such as
`reconstructCameraAt(master)` called by `seekTo()` is preferable to teaching
`choreo-player` about camera internals. `choreo-player` should only own the
transport; Choreo must make `run.time = t` truthful for every kind of cue.

## Regression tests

Add focused coverage under `packages/choreo/tests/integration/choreo/`, either in
`camera-tether-test.gts` or a new `camera-transport-test.gts`.

Minimum cases:

1. **Direct seek into a wait**
   - Camera A, wait, Camera B, wait.
   - Compile and immediately set the run time into the first wait.
   - Assert the frame transform equals Camera A's landed pose.

2. **Direct seek into a later camera**
   - Immediately seek into the midpoint of Camera B without first seeking or
     playing Camera A.
   - Assert Camera B interpolates from Camera A's final pose, not identity.

3. **Direct seek into the final wait**
   - Immediately seek after Camera B completes.
   - Assert Camera B's landed pose is held.

4. **Backward reconstruction**
   - Seek to the final wait, then into Camera A, then to zero.
   - Assert each still matches a fresh run sought directly to the same time.

5. **Random-order idempotence**
   - Seek `[late, early, middle, late]` and compare the two late transforms.

6. **Aim inheritance**
   - Camera A fits/aims at one sprite; Camera B changes zoom without supplying
     a new origin.
   - Assert the inherited aim matches forward playback.

7. **Gate preservation**
   - Place a gate between the cameras and seek beyond it.
   - Assert time and camera state clamp at the gate as they do today.

Use the real public transport (`run.pause(); run.time = seconds`) and assert
computed frame transforms. Do not sleep; use the existing motion test support
and render-settling helpers.

## Acceptance proof

After the engine tests pass:

1. Revert the reel's constant-pose camera workaround back to ordinary
   `c.Camera` followed by `c.Wait`.
2. Remove the yellow capture trace overlay/instrumentation.
3. Build the addon and test app.
4. Run the packaged five-frame check at `1.5,5.1,8.9,10.8,14.5`.
5. Confirm the five frames show three distinct real demos and the final Build
   Order logo pose.
6. Render the full 15-second, 1920×1080, 60fps output and inspect extracted
   frames from the encoded MP4.

Do not change `choreo-player` to replay elapsed wall-clock frames. Independent
random-access rendering is the contract we are trying to prove.
