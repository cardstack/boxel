# Spatial and film routing

Choose the boundary before choosing a demo. Read only the row needed for the task.
Guide paths below are under `packages/choreo-gallery/realm/docs/guides/`;
implementation exports remain the authority for accepted arguments.

| Intent                                 | Read                                                 | Minimal source reference                                                              |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Frame or pan across DOM                | spatial-frame.md                                     | stages/camera.gts; stages/long-take/board.gts                                         |
| Relative pose or coordinate conversion | spatial-relative.md; spatial-coordinates.md          | `packages/choreo/src/choreo.gts` vocabulary; `lib/css3d.ts`                           |
| 3D camera path and look target         | spatial-camera3d.md; spatial-paths.md                | stages/mockup.gts; stages/long-take.gts                                               |
| Place live DOM on a mesh plane         | spatial-dom.md; spatial-compositing.md               | stages/mockup.gts; `packages/choreo-gallery/realm/docs/dom-in-3d.md`                  |
| Film graph, shots and picture actor    | film-graph.md; film-picture.md                       | `packages/choreo-film-app/app/components/`: tower-film.gts; sagrada-film.gts          |
| Seek, pause or capture                 | film-transport.md; film-schedule.md                  | `packages/choreo-gallery/realm/docs/demo-recording.md`; `packages/choreo-player/src/` |
| Joins and readiness                    | film-joins.md; film-seam-readiness.md                | `packages/choreo/src/film/`                                                           |
| Separate clips, audio and captions     | film-audio.md; film-audio-mix.md; film-typography.md | `lib/widget-narration.ts`; `@cardstack/choreo/film` exports                           |
| World labels and adjustments           | film-world-annotations.md; film-adjustments.md       | picture capability implementation and its Film score                                  |

`stages/` and `lib/` paths are relative to `packages/choreo-gallery/realm/`; a
demo's stage is `stages/<id>.gts`. Other paths are repository-relative.

Keep three owners explicit: the application owns semantic state, Choreo/Film owns
the requested sequence and time, and the picture renderer owns geometry, lights,
projection and readiness. A CSS pixel, world unit and camera-relative value are
not interchangeable. Derive hit testing from the same transform as the visible DOM.

A chased camera depends on history. Do not call a timestamp an exact frame until
its reconstruction policy is defined and tested. Shared shot data can coordinate
nested cameras; independent hard-coded durations drift. A render barrier means
the requested picture is ready, not merely that an arbitrary delay expired.

For a tutorial, prefer a tiny procedural scene that isolates one relationship.
Use `packages/choreo-gallery/realm/design/docs-studies-plan.md` for the planned docs-only studies. They are not
shipped examples. Keep full museum films as composition references rather than
forcing their assets, narration and lighting into every camera exercise.
