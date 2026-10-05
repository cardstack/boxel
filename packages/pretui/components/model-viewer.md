## What it is

A 3D model — `.glb` or `.gltf` — with orbit controls, an environment, and AR where the device offers it. It is the only component in the kit that loads a rendering engine.

It is not routed by **MediaViewer** unless a host opts in: `installModelAdapter()` registers it, deliberately as a function call rather than a module side effect, because importing a component must not silently change how every other viewer in the process behaves and this one costs 292 KB gzipped.

## The contract

```
@src (required)  — URL of a .glb or .gltf; passed through untouched
@alt (required)  — description of the model
@poster?         — image shown before the model is asked for, and the reserved space while it loads
@iosSrc?         — iOS Quick Look source, for AR on Safari
@ar?             — offer the AR button where the device supports it. Default false
@height?         — stage height in px. Default 320
@ratio?          — stage aspect ratio, e.g. '4 / 3'; beats @height when both are given
@step?           — degrees moved by one arrow press. Default 15
@orbit?          — start facing this way
@onLoad?         — fires when the model finishes loading
@onOrbit?        — fires on every camera change from our controls
```

**The model is not loaded until it is asked for.** The component starts in a poster phase and stays there; loading a 3D scene because a component happened to scroll into view is the spatial version of autoplay. The poster doubles as the reserved space, so the stage never flashes an empty canvas.

**`@alt` is required rather than optional**, which is unusual in this kit and correct here: it is the only thing a screen reader can be told about a 3D object.

**`@ratio` beats `@height`** when both are given, because a ratio survives a responsive width and a fixed height does not.

**The phase is public** — poster, loading, ready, error — so a host can reflect it.

**Failure is a state with a message and a link, not a grey box.** A model that will not load is the normal case offline, behind auth, or on a machine with no WebGL, so the error names itself and the file is still offered as a link.

## Prior art

Built on **`@google/model-viewer`** (Apache-2.0), chosen over React Three Fiber, which cannot run in this environment at all.

Where Pretui is better, and this is the substantial part: **the orbit camera is keyboard-complete, and that is the kit's work rather than the upstream's.** model-viewer's own keyboard support is arrow keys on a focused element with no announced position whatsoever — you can turn the model and never be told that you did, or which way it now faces. Here the stage is a `role='slider'` over the camera's **azimuth**, which is the axis a person actually thinks in, with a full key contract over it. The deferred load and the honest failure state are the other two additions.

Where it is thinner: one model at a time, no scene composition, no annotations or hotspots (model-viewer supports them; this does not expose them), no material or variant switching, and no lighting control beyond the environment it ships with. Elevation and zoom are reachable by keyboard but are not themselves announced as separate sliders — the single slider covers azimuth, and the other two axes ride in its value text.

## Accessibility

- **The stage is a `role='slider'` over the azimuth**, with `aria-valuemin='-180'`, `aria-valuemax='180'`, a live `aria-valuenow`, and `aria-label` taken from `@alt`.
- **`aria-valuetext` is written in human terms** — "turned 45° right, 20° above, 105% zoom" — rather than emitting a quaternion or a raw degree count. That one string is what makes the control usable without sight, and it carries all three axes even though only one of them is the slider's own value.
- **The key contract is complete**: ←/→ turn by `@step`, Shift for a coarse step, PageUp/PageDown turn 90°, Home faces front, End faces back, ↑/↓ change elevation, `+`/`−` zoom.
- **The slider is `aria-disabled` until the model is revealed**, so a reader is not offered a camera for a scene that has not been asked for yet.
- **The slider's children are presentational** — the overlay is deliberately empty, because `role='slider'` takes presentational children and anything inside it would be hidden from assistive technology anyway.
- **The failure state is text and a real link**, so an unloadable model is still reachable and still named.
- **`@alt` being required is the accessibility contract**, and it is enforced by the type rather than by a runtime warning.

## Theming

`--pretui-model-h` (the stage height, from `@height`), `--pretui-model-ratio` (the stage ratio, from `@ratio`), `--pretui-primary-ink` (the AR and link affordances), `--pretui-destructive-ink` (the error state), `--pretui-shadow-hairline`, `--pretui-z-raised` (the overlay's layer).

The environment and lighting come from the engine rather than from tokens, which is the one place in the kit where a season does not reach: a model lit by the theme would need a lighting model the component does not own. Everything around the stage — the poster, the error state, the AR button — is themed normally, so the frame follows the season even though the scene inside it does not.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
