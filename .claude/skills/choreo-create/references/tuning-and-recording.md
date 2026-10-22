# Live Tuning and Repeatable Recording

## DialKit 2 in Glimmer

The app pins DialKit 2 and uses `dialkit/vanilla`. The vanilla root includes the spring/easing editor, typed numeric inputs, versions, and copying. The older Glimmer `Dial` bridge remains useful for tracked snapshots and existing physics demos; its store instance must come from the same vanilla entry as the controls. A resolver imported from `dialkit/store` is pure, but using two independently bundled store singletons disconnects controls from consumers.

Use `createDialRoot({ mode: 'inline', target, productionEnabled: true })` in an element modifier when embedding a root. `createDialKit` registers a panel; its subscription emits values immediately and on changes. Dispose the subscription, panel, and root on teardown. Do not create one full root per live gallery tile; open a single focused workspace or an isolated inline example.

A store callback may run during a Glimmer render. Queue a microtask to commit tracked values, keep one consistent snapshot per update, and ignore queued work after destruction. Do not turn that lifecycle deferral into animation sequencing.

DialKit's easing config uses `type: 'easing'`; Motion's transition uses `type: 'tween'`. Translate at the boundary. When changing spring modes, remove incompatible duration/physics fields rather than retaining both sets from a previous preset. Preserve repeat, stagger, and per-property behavior deliberately.

Existing components:

- `packages/choreo-gallery/realm/lib/dial.ts`: tracked bridge and existing preset operations.
- `packages/choreo-gallery/realm/shell/dial-panel.gts`: full native control renderer in the existing Glimmer panel.
- `packages/choreo-gallery/realm/shell/lab-panel.gts` and `packages/choreo-gallery/realm/lib/lab.ts`: the demo lab, with replay and controls for that demo’s named source variables.
- `packages/choreo-gallery/realm/lib/tuning.ts`: the demo-only adapter; defaults return the original transition unchanged.

For a new demo, declare named variables in the demo code and let DialKit supply their values. Use `tuneNumber(demoId, defaultValue, "variableName (px)", min, max, step)` for a numeric variable, `tuneSeconds(demoId, seconds, "label")` for a Choreo step time (step times are seconds), or `tuneSpring(demoId, springConstant, "springName")` for an existing spring. The name, default, and consumer must be traceable at the call site. Label durations in seconds, positions in pixels or explicit scene units, angles in degrees, and scales as multipliers. Round slider bounds so floating-point multiplication cannot create excessive display precision. Expose actual semantic parameters rather than merely recoloring the container. Good examples are spring duration/bounce, departure distance, stagger, camera framing, and simulation force. Apply values to the existing renderer or timeline. Keep a route out of experiments: reset must recover the original defaults.

## Live edits and authored presets

An edit reaches the demo as it renders; motion already in flight keeps its
timing until the demo moves again, so the lab's replay runs it from the start
with the new values. Reuse the existing visual elements and preserve repeating
phase. Do not remount the demo
for every slider change. Register variables needed by a lazily evaluated Choreo
pass before interaction so the initial panel is usable.

`packages/choreo-gallery/realm/lib/presets.ts` stores explicit named values per demo, not a generic multiplier.
The lab offers a preset beside the demo's own defaults only once the demo has
registered every control it names. Check preset ranges and actual consumers; a car's transition
preset is not a simulation grip control. For relevant edits, run the host
integration modules `Choreo gallery | tuning`
(`packages/host/tests/integration/choreo-gallery-tuning-test.ts`) and
`Choreo gallery | guides and the lab` (`choreo-gallery-guides-test.gts`, which
opens a demo's lab and applies a preset) with
`ember test --path dist --filter "<module>"` from `packages/host`.

## Clock Ownership

An interactive component should remain interactive until a recorder explicitly takes ownership. `@cardstack/choreo-player` accepts `runs()` and an optional `prepare()` hook; it must not pause every run discovered on the page.

A capture request is a transaction: establish the score, derive application state at time t, await the Glimmer pass, reassert the still at t, then capture. Verify identical frames when t is reached by forward seeking, backward seeking, and a fresh page.

At 60 fps use t = frame / 60. Frame rendering time does not advance the film clock. Wait for fonts, media, models, and the host's actual render barrier. Test the encoded file's audio, color, first frame, last frame, and the seams around live-content activation.

For separate narration clips, test success, a failed first load, retry, pause/resume, natural completion, and replay. A blocked autoplay request needs a user gesture; a failed media source needs a fresh load or a defined skip. Do not report a tour as reliable after testing only one clip.
