# Combining Demonstrated Patterns

Use the catalog to resolve the components named below. These are starting points; adapt the combination to the requested product and verify every API against the actual example.

## Core glimmer-motion

- **Responsive controls:** `gestures` + `pointer`. The button owns its hover/press targets; the follower uses motion values rather than a tracked update every frame. Keep focus and keyboard actions independent of pointer effects.
- **Expandable collections:** `layout` + `presence` + `reorder`. Stable data IDs survive filtering and ordering. Layout measures real nodes; Presence keeps only the departing content alive. Decide whether removal and reordering are simultaneous or need Choreo ordering.
- **Readable scrolling:** `parallax` + `reveal` + `header`. Scroll progress drives transforms; visibility gates expensive work. Text must remain readable when movement is reduced.

## Interactive Choreo

- **Inbox to workspace:** `inbox` + `far` + `split`. Beacons identify a destination, while far matching transfers a persistent item between regions. Update source and destination in the same render pass. Let the layout own final bounds.
- **Interactive presentation:** `sequence` + `interrupt` + `slides`. Keep a semantic state model, then score the changeset. Check fast repeated actions instead of disabling the interface until every animation finishes.

## Spatial & 3D Choreo

- **Spatial product demo:** `mockup` + `long-take` + `camera`. Reuse actual DOM on a plane, project it from the renderer's matrices, and direct the camera with `c.Camera3D`. The host renderer still owns lighting and models. Inspect interaction hit targets and texture/model readiness.
- **Physical play:** `drift` + `hang` + `grip`. Read each demo's physics model before combining controls. A spring transition does not replace a simulation's friction, grip, or fixed-step integration. Bound every parameter combination to a usable state.

## Recorded & Film Choreo

- **Explainer from a working app:** `playhead` + `presentation` + `build-order`. Make named semantic actions reproducible at a timestamp; use one cursor to illustrate them. A recorder must reconstruct state, not replay all previous mouse events at wall-clock speed.
- **Architectural film:** the `towers` and `sagrada` film routes and their film/score components. Reuse the Film graph: spine, chapters, shots, picture actors, type, voice, and joins. Distinguish exact seeking from the chased camera's cut mode.
- **Guided gallery:** `widget-room.gts`, `widget-quick-tour.ts`, `widget-tour.ts`, and `widget-narration.ts`. Organize chapters around capabilities, score the camera and actions together, and budget live demos to the active view. Preserve a preview until the replacement is visibly ready.

Read `docs/film.md` for as-built Film contracts, `docs/demo-recording.md` for ownership, and `docs/dom-in-3d.md` for the DOM projection boundary. Design documents sometimes describe proposed capabilities; use exported source to confirm availability.
