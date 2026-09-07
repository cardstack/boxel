# Live Tuning and Repeatable Recording

## DialKit 2 in Glimmer

The app pins DialKit 2 and uses `dialkit/vanilla`. The vanilla root includes the spring/easing editor, typed numeric inputs, versions, and copying. The older Glimmer `Dial` bridge remains useful for tracked snapshots and existing physics demos; its store instance must come from the same vanilla entry as the controls. A resolver imported from `dialkit/store` is pure, but using two independently bundled store singletons disconnects controls from consumers.

Use `createDialRoot({ mode: 'inline', target, productionEnabled: true })` in an element modifier when embedding a root. `createDialKit` registers a panel; its subscription emits values immediately and on changes. Dispose the subscription, panel, and root on teardown. Do not create one full root per live gallery tile; open a single focused workspace or an isolated inline example.

A store callback may run during a Glimmer render. Queue a microtask to commit tracked values, keep one consistent snapshot per update, and ignore queued work after destruction. Do not turn that lifecycle deferral into animation sequencing.

DialKit's easing config uses `type: 'easing'`; Motion's transition uses `type: 'tween'`. Translate at the boundary. When changing spring modes, remove incompatible duration/physics fields rather than retaining both sets from a previous preset. Preserve repeat, stagger, and per-property behavior deliberately.

Existing components:

- `test-app/app/lib/dial.ts`: tracked bridge and existing preset operations.
- `test-app/app/components/dial-native-controls.gts`: full native control renderer in the existing Glimmer panel.
- `test-app/app/components/demo-workbench.gts`: catalog workspace, replay, and controls for that demo’s named source variables.
- `test-app/app/lib/demo-tuning.ts`: the demo-only adapter; defaults return the original transition unchanged.

For a new demo, declare named variables in the demo code and let DialKit supply their values. Use `tuneNumber(demoId, defaultValue, "variableName (px)", min, max, step)` for a numeric variable, or `tuneSpring(demoId, springConstant, "springName")` for an existing spring. The name, default, and consumer must be traceable at the call site. Label durations in seconds, positions in pixels or explicit scene units, angles in degrees, and scales as multipliers. Round slider bounds so floating-point multiplication cannot create excessive display precision. Expose actual semantic parameters rather than merely recoloring the container. Good examples are spring duration/bounce, departure distance, stagger, camera framing, and simulation force. Apply values to the existing renderer or timeline. Keep a route out of experiments: reset must recover the original defaults.

## Clock Ownership

An interactive component should remain interactive until a recorder explicitly takes ownership. `choreo-player` accepts `runs()` and an optional `prepare()` hook; it must not pause every run discovered on the page.

A capture request is a transaction: establish the score, derive application state at time t, await the Glimmer pass, reassert the still at t, then capture. Verify identical frames when t is reached by forward seeking, backward seeking, and a fresh page.

At 60 fps use t = frame / 60. Frame rendering time does not advance the film clock. Wait for fonts, media, models, and the host's actual render barrier. Test the encoded file's audio, color, first frame, last frame, and the seams around live-content activation.

For separate narration clips, test success, a failed first load, retry, pause/resume, natural completion, and replay. A blocked autoplay request needs a user gesture; a failed media source needs a fresh load or a defined skip. Do not report a tour as reliable after testing only one clip.
