# API and Concept Inventory

Choreo has four connected areas: an element binding over Motion, interactive scene choreography, spatial direction, and recorded film composition. This inventory maps the public entrypoints and yielded vocabularies to the guides that explain their behavior. Use it when you know an API name, when you are planning an application, or when you want to check whether a concept has been documented beyond an introductory example.

## Scope and Reading Depth

The inventory covers the `glimmer-motion` root, the `glimmer-motion/film` subpath, the `glimmer-motion/test-support` and `glimmer-motion/choreo/test-support` subpaths, and the separate `choreo-player` package. It also includes the components and queries yielded by ChoreoContext and FilmVocabulary. Each entry links to a substantial concept chapter with motivation, behavior, examples, and relevant constraints.

Related helpers, compatibility aliases, and supporting TypeScript types share the chapter about the behavior they describe. For example, a spring configuration and its argument type belong with spring transitions; the several query selectors belong with the changeset model. This avoids pretending that a type alias is an independent feature while still making every exported name discoverable.

Each guide contains at least 300 words of explanatory prose, approximately three-quarters of a conventional documentation page, excluding code blocks and API tables. This is a minimum depth check rather than a measure of completeness by itself. Complex concepts include additional examples and links to adjacent contracts. A longer page should add useful explanation, not repeat the same introduction in different words.

## Implementation and Integration Boundaries

The inventory reflects the checked-in implementation. Historical design notes can include proposals or older signatures, so the source links beside an API are the authority for its current shape. Advanced host APIs and the external-provider lane surface are identified as integration work rather than required application patterns. Wildcard deep imports expose implementation modules, but the inventory does not promise every internal helper as a supported standalone application API.

The library uses MotionValues from `motion-dom` directly. The continuous-value guide explains that integration without inventing a Choreo re-export. Similarly, the spatial guides distinguish camera direction from renderer capabilities, and the film guides distinguish a compiled graph from decoded, paintable media. Those boundaries are part of learning the system, not details to skip when assembling a demonstration.

## Maintaining Coverage

Run `pnpm docs:check` after changing an export or a guide. The check compares this inventory with the actual source declarations, verifies guide destinations and preambles, and enforces the minimum prose depth. A new public symbol fails that check until its documentation mapping is reviewed. Browser verification still matters for examples, controls, and renderer behavior; a coverage table alone cannot prove that a demonstration works.

## Find an API

### glimmer-motion

| API                       | Guide                                                          | Source                                                                                                                       |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `beacon`                  | [interactive-beacons](/docs/interactive-beacons)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/beacon.ts)                        |
| `ChoreoContext`           | [interactive-start](/docs/interactive-start)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts)                       |
| `Choreo`                  | [interactive-start](/docs/interactive-start)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts)                       |
| `AnchorRef`               | [interactive-anchors](/docs/interactive-anchors)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/anchors.ts)                |
| `after`                   | [interactive-anchors](/docs/interactive-anchors)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/anchors.ts)                |
| `at`                      | [interactive-anchors](/docs/interactive-anchors)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/anchors.ts)                |
| `Arming`                  | [interactive-arming](/docs/interactive-arming)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/arming.ts)                 |
| `ArmingOptions`           | [interactive-arming](/docs/interactive-arming)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/arming.ts)                 |
| `ArmingRegion`            | [interactive-arming](/docs/interactive-arming)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/arming.ts)                 |
| `createArming`            | [interactive-arming](/docs/interactive-arming)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/arming.ts)                 |
| `BeaconRef`               | [interactive-beacons](/docs/interactive-beacons)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/beacons.ts)                |
| `Changeset`               | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/changeset.ts)              |
| `easeIn`                  | [core-tweens](/docs/core-tweens)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/easings.ts)                |
| `easeInAndOut`            | [core-tweens](/docs/core-tweens)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/easings.ts)                |
| `easeOut`                 | [core-tweens](/docs/core-tweens)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/easings.ts)                |
| `GestureRef`              | [core-drag](/docs/core-drag)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/gesture.ts)                |
| `ChoreoHost`              | [interactive-registry](/docs/interactive-registry)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/registry.ts)               |
| `choreoHostAt`            | [interactive-registry](/docs/interactive-registry)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/registry.ts)               |
| `choreoHostById`          | [interactive-registry](/docs/interactive-registry)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/registry.ts)               |
| `ChoreoProvider`          | [interactive-registry](/docs/interactive-registry)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/registry.ts)               |
| `closestChoreo`           | [interactive-registry](/docs/interactive-registry)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/registry.ts)               |
| `ChoreoRun`               | [interactive-run](/docs/interactive-run)                       | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/run.ts)                    |
| `PlanePoint`              | [spatial-coordinates](/docs/spatial-coordinates)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/space.ts)                  |
| `appliedCamera`           | [spatial-coordinates](/docs/spatial-coordinates)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/space.ts)                  |
| `toLocal`                 | [spatial-coordinates](/docs/spatial-coordinates)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/space.ts)                  |
| `toPage`                  | [spatial-coordinates](/docs/spatial-coordinates)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/space.ts)                  |
| `StepArgs`                | [interactive-composites](/docs/interactive-composites)         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/steps.gts)                 |
| `StepArgsBase`            | [interactive-composites](/docs/interactive-composites)         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/steps.gts)                 |
| `StepComponent`           | [interactive-composites](/docs/interactive-composites)         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/steps.gts)                 |
| `toMs`                    | [interactive-composites](/docs/interactive-composites)         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/steps.gts)                 |
| `Block`                   | [interactive-blocks](/docs/interactive-blocks)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `Bounds`                  | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `Camera3DState`           | [spatial-camera3d](/docs/spatial-camera3d)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `Camera3DWaypoint`        | [spatial-paths](/docs/spatial-paths)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `CameraState`             | [spatial-frame](/docs/spatial-frame)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `DeliveryBy`              | [interactive-delivery](/docs/interactive-delivery)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `DeliveryOrder`           | [interactive-delivery](/docs/interactive-delivery)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `DeriveContext`           | [interactive-follow](/docs/interactive-follow)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `Easing`                  | [core-tweens](/docs/core-tweens)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `FollowSource`            | [interactive-follow](/docs/interactive-follow)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `GateNode`                | [interactive-gates](/docs/interactive-gates)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `PerformCommand`          | [interactive-commands](/docs/interactive-commands)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `PropSource`              | [interactive-property-steps](/docs/interactive-property-steps) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `PropValue`               | [interactive-property-steps](/docs/interactive-property-steps) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `Query`                   | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `Rect`                    | [spatial-coordinates](/docs/spatial-coordinates)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `SpringSpec`              | [core-springs](/docs/core-springs)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `Sprite`                  | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `Step`                    | [interactive-composites](/docs/interactive-composites)         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `TimelineNode`            | [interactive-composites](/docs/interactive-composites)         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts)                  |
| `scroll`                  | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `scrollInfo`              | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `ScrollInfo`              | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `ScrollOffset`            | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `ScrollOptions`           | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `InViewOptions`           | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `inView`                  | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `Film`                    | [film-start](/docs/film-start)                                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film.ts)                          |
| `FilmBeat`                | [film-poses](/docs/film-poses)                                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)                    |
| `FilmCam`                 | [film-poses](/docs/film-poses)                                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)                    |
| `FilmChapter`             | [film-graph](/docs/film-graph)                                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)                    |
| `FilmClock`               | [film-schedule](/docs/film-schedule)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)                    |
| `FilmGrade`               | [film-adjustments](/docs/film-adjustments)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)                    |
| `FilmHandle`              | [film-transport](/docs/film-transport)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)                    |
| `FilmJoin`                | [film-joins](/docs/film-joins)                                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)                    |
| `FilmPicture`             | [film-picture](/docs/film-picture)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)                    |
| `createDragControls`      | [core-drag-handles](/docs/core-drag-handles)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/gestures/drag-controls.ts)        |
| `DragControls`            | [core-drag-handles](/docs/core-drag-handles)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/gestures/drag-controls.ts)        |
| `correctParentTransform`  | [core-drag-handles](/docs/core-drag-handles)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/gestures/transform-page-point.ts) |
| `transformViewBoxPoint`   | [core-drag-handles](/docs/core-drag-handles)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/gestures/transform-page-point.ts) |
| `InertiaArgs`             | [core-drag](/docs/core-drag)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `SpringArgs`              | [core-springs](/docs/core-springs)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `TweenArgs`               | [core-tweens](/docs/core-tweens)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `ease`                    | [core-tweens](/docs/core-tweens)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `inertia`                 | [core-drag](/docs/core-drag)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `perValue`                | [core-targets](/docs/core-targets)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `spring`                  | [core-springs](/docs/core-springs)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `stagger`                 | [core-variants](/docs/core-variants)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `styles`                  | [core-targets](/docs/core-targets)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `to`                      | [core-targets](/docs/core-targets)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `tween`                   | [core-tweens](/docs/core-tweens)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `afterSettle`             | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `instantLayoutTransition` | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `layoutChange`            | [core-layout](/docs/core-layout)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `layoutLoopDetected`      | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `requestSettle`           | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `resetLayoutLoopGuard`    | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `snapshotAll`             | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `closestLayoutGroup`      | [core-layout](/docs/core-layout)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout-group.gts)                 |
| `LayoutGroup`             | [core-layout](/docs/core-layout)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout-group.gts)                 |
| `snapshotOnRender`        | [core-layout](/docs/core-layout)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout-group.gts)                 |
| `MotionEl`                | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/motion.ts)                        |
| `MotionProps`             | [core-elements](/docs/core-elements)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/motion.ts)                        |
| `motion`                  | [core-elements](/docs/core-elements)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/motion.ts)                        |
| `MotionModifier`          | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/motion.ts)                        |
| `MotionConfigContext`     | [core-config](/docs/core-config)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/motion-config.gts)                |
| `closestMotionConfig`     | [core-config](/docs/core-config)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/motion-config.gts)                |
| `MotionConfig`            | [core-config](/docs/core-config)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/motion-config.gts)                |
| `flushPendingMounts`      | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/node.ts)                          |
| `MotionNode`              | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/node.ts)                          |
| `Presence`                | [core-presence](/docs/core-presence)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/presence.gts)                     |
| `PresenceHandle`          | [core-presence](/docs/core-presence)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/presence-types.ts)                |
| `ReorderGroup`            | [core-reorder](/docs/core-reorder)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/reorder/group.gts)                |
| `ReorderItem`             | [core-reorder](/docs/core-reorder)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/reorder/item.gts)                 |
| `ReorderAxis`             | [core-reorder](/docs/core-reorder)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/reorder/types.ts)                 |
| `ReorderContextProps`     | [core-reorder](/docs/core-reorder)                             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/reorder/types.ts)                 |
| `postRender`              | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scheduler.ts)                     |
| `setPostRender`           | [core-host](/docs/core-host)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scheduler.ts)                     |
| `ScrollValues`            | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `UseInViewOptions`        | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `UseScrollOptions`        | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `InView`                  | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `scrollProgress`          | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `useInView`               | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `useScroll`               | [core-scroll](/docs/core-scroll)                               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `motionSpeed`             | [core-tempo](/docs/core-tempo)                                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/speed.ts)                         |
| `onMotionSpeed`           | [core-tempo](/docs/core-tempo)                                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/speed.ts)                         |
| `scaleTransition`         | [core-tempo](/docs/core-tempo)                                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/speed.ts)                         |
| `setMotionSpeed`          | [core-tempo](/docs/core-tempo)                                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/speed.ts)                         |
| `ViewTransitionBuilder`   | [core-page-transitions](/docs/core-page-transitions)           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/view-transition.ts)               |
| `ViewTransitionOptions`   | [core-page-transitions](/docs/core-page-transitions)           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/view-transition.ts)               |
| `ViewTransitionUpdate`    | [core-page-transitions](/docs/core-page-transitions)           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/view-transition.ts)               |
| `animateView`             | [core-page-transitions](/docs/core-page-transitions)           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/view-transition.ts)               |
| `viewTransition`          | [core-page-transitions](/docs/core-page-transitions)           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/view-transition.ts)               |

### glimmer-motion/film

| API                      | Guide                                                  | Source                                                                                                            |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `Clip`                   | [film-clips](/docs/film-clips)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clip.gts)         |
| `ClipEnd`                | [film-clips](/docs/film-clips)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts)         |
| `ClipKind`               | [film-clips](/docs/film-clips)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts)         |
| `clipLanes`              | [film-clips](/docs/film-clips)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts)         |
| `ClipLook`               | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts)         |
| `ClipSpec`               | [film-clips](/docs/film-clips)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts)         |
| `ClipState`              | [film-clips](/docs/film-clips)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts)         |
| `clipWindow`             | [film-clips](/docs/film-clips)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts)         |
| `resolveClip`            | [film-clips](/docs/film-clips)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts)         |
| `resolveClips`           | [film-clips](/docs/film-clips)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts)         |
| `ResolvedClip`           | [film-clips](/docs/film-clips)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/clips.ts)         |
| `Film`                   | [film-start](/docs/film-start)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/film.gts)         |
| `FilmContext`            | [film-start](/docs/film-start)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/film.gts)         |
| `FilmSignature`          | [film-start](/docs/film-start)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/film.gts)         |
| `TICK`                   | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/film.gts)         |
| `Adjustment`             | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `Build`                  | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `Filter`                 | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `IFRAME_PICTURE`         | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `Light`                  | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `Look`                   | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `Mix`                    | [film-audio-mix](/docs/film-audio-mix)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `Set`                    | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `SOUND`                  | [film-audio-mix](/docs/film-audio-mix)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `Sun`                    | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `Weather`                | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `Winter`                 | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/adjust.gts) |
| `AttachNode`             | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `CompiledGraph`          | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `compileGraph`           | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `EyeNode`                | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `GraphNode`              | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `GroupNode`              | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `JoinNode`               | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `Patch`                  | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `PatchNode`              | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `ShotNode`               | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `ToNode`                 | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `VoiceNode`              | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/compile.ts) |
| `FilmGraph`              | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts)   |
| `FilmGraphSignature`     | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts)   |
| `FilmVocabulary`         | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts)   |
| `VOCABULARY`             | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts)   |
| `collectGraph`           | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Eye`                    | [film-poses](/docs/film-poses)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Freeze`                 | [film-media-graph](/docs/film-media-graph)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `GraphAttach`            | [film-media-graph](/docs/film-media-graph)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `GraphChapter`           | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `GraphInsert`            | [film-media-graph](/docs/film-media-graph)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `GraphNodeComponent`     | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `GraphProvider`          | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `GraphStamp`             | [film-world-annotations](/docs/film-world-annotations) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `JoinInto`               | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Lineup`                 | [film-world-annotations](/docs/film-world-annotations) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Mark`                   | [film-world-annotations](/docs/film-world-annotations) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `PatchComponent`         | [film-graph-extension](/docs/film-graph-extension)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Sequence`               | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Shot`                   | [film-poses](/docs/film-poses)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Sky`                    | [film-world-annotations](/docs/film-world-annotations) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Spine`                  | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `To`                     | [film-poses](/docs/film-poses)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Trace`                  | [film-world-annotations](/docs/film-world-annotations) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Type`                   | [film-typography](/docs/film-typography)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Video`                  | [film-media-graph](/docs/film-media-graph)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Voice`                  | [film-audio-mix](/docs/film-audio-mix)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/nodes.gts)  |
| `Blend`                  | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `Blur`                   | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `Dip`                    | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `Flash`                  | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `inGlass`                | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `Iris`                   | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `JOIN_SECS`              | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `Joins`                  | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `Luma`                   | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `Melt`                   | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `Presentation`           | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `PresentationComponent`  | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `PRESENTATIONS`          | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `PresentationSignature`  | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `retire`                 | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `seamShape`              | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `STILL_JOINS`            | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `Wipe`                   | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/joins.gts)        |
| `clamp01`                | [film-utilities](/docs/film-utilities)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/math.ts)          |
| `hex`                    | [film-utilities](/docs/film-utilities)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/math.ts)          |
| `lerp`                   | [film-utilities](/docs/film-utilities)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/math.ts)          |
| `luminance`              | [film-utilities](/docs/film-utilities)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/math.ts)          |
| `mmss`                   | [film-utilities](/docs/film-utilities)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/math.ts)          |
| `RAD`                    | [film-utilities](/docs/film-utilities)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/math.ts)          |
| `rgba`                   | [film-utilities](/docs/film-utilities)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/math.ts)          |
| `smooth`                 | [film-utilities](/docs/film-utilities)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/math.ts)          |
| `Captions`               | [film-typography](/docs/film-typography)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/overlays.gts)     |
| `Insert`                 | [film-typography](/docs/film-typography)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/overlays.gts)     |
| `Stamp`                  | [film-typography](/docs/film-typography)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/overlays.gts)     |
| `Track`                  | [film-typography](/docs/film-typography)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/overlays.gts)     |
| `IframePicture`          | [film-picture](/docs/film-picture)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/picture.gts)      |
| `IframePictureSignature` | [film-picture](/docs/film-picture)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/picture.gts)      |
| `PictureSpec`            | [film-picture](/docs/film-picture)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/picture.gts)      |
| `Plate`                  | [film-typography](/docs/film-typography)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/plate.gts)        |
| `Burst`                  | [film-interface](/docs/film-interface)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/player.gts)       |
| `Menu`                   | [film-interface](/docs/film-interface)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/player.gts)       |
| `MenuEntry`              | [film-interface](/docs/film-interface)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/player.gts)       |
| `PlaybarSegment`         | [film-interface](/docs/film-interface)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/player.gts)       |
| `Player`                 | [film-interface](/docs/film-interface)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/player.gts)       |
| `Rail`                   | [film-interface](/docs/film-interface)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/rail.gts)         |
| `RailMark`               | [film-interface](/docs/film-interface)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/rail.gts)         |
| `beatStart`              | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `chapterHeads`           | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `Content`                | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `contents`               | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `Cue`                    | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `cues`                   | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `joinInto`               | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `Schedule`               | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `schedule`               | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `secsBefore`             | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `tailFor`                | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `totalSecs`              | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `Waypoint`               | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `waypoints`              | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/schedule.ts)      |
| `Seam`                   | [film-seam-readiness](/docs/film-seam-readiness)       | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/seam.ts)          |
| `EndCard`                | [film-interface](/docs/film-interface)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/titles.gts)       |
| `Gate`                   | [film-interface](/docs/film-interface)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/titles.gts)       |
| `Beat`                   | [film-poses](/docs/film-poses)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `Cam`                    | [film-poses](/docs/film-poses)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `Chapter`                | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `FilmClock`              | [film-schedule](/docs/film-schedule)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `FilmGrade`              | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `FilmHandle`             | [film-transport](/docs/film-transport)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `Join`                   | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `JoinName`               | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `LookFx`                 | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `Over`                   | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `Picture`                | [film-picture](/docs/film-picture)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `PlateMode`              | [film-typography](/docs/film-typography)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `Pt3`                    | [film-poses](/docs/film-poses)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `SeamSpec`               | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |
| `ShotState`              | [film-poses](/docs/film-poses)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/types.ts)         |

### glimmer-motion/test-support

| API                   | Guide                                          | Source                                                                                                            |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `isMotionIdle`        | [core-test-timing](/docs/core-test-timing)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/activity.ts)           |
| `whatIsBusy`          | [core-test-timing](/docs/core-test-timing)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/activity.ts)           |
| `Box`                 | [core-test-geometry](/docs/core-test-geometry) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `bounds`              | [core-test-geometry](/docs/core-test-geometry) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `shape`               | [core-test-geometry](/docs/core-test-geometry) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `boundsAndShape`      | [core-test-geometry](/docs/core-test-geometry) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `SettleOptions`       | [core-test-timing](/docs/core-test-timing)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `animationsSettled`   | [core-test-timing](/docs/core-test-timing)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `velocityOf`          | [core-test-geometry](/docs/core-test-geometry) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `setupMotion`         | [core-test-timing](/docs/core-test-timing)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `resetMotion`         | [core-test-timing](/docs/core-test-timing)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `registerMotionReset` | [core-test-timing](/docs/core-test-timing)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/test-support/index.ts) |

### glimmer-motion/choreo/test-support

| API                  | Guide                                          | Source                                                                                                                   |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `setupChoreo`        | [core-test-timing](/docs/core-test-timing)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/test-support/index.ts) |
| `advanceGate`        | [core-test-timing](/docs/core-test-timing)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/test-support/index.ts) |
| `seekTo`             | [core-test-timing](/docs/core-test-timing)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/test-support/index.ts) |
| `orphanCount`        | [core-test-geometry](/docs/core-test-geometry) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/test-support/index.ts) |
| `live`               | [core-test-geometry](/docs/core-test-geometry) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/test-support/index.ts) |
| `liveAll`            | [core-test-geometry](/docs/core-test-geometry) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/test-support/index.ts) |
| `strandedTransforms` | [core-test-geometry](/docs/core-test-geometry) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/test-support/index.ts) |

### choreo-player

| API                         | Guide                            | Source                                                                                              |
| --------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ChoreoRun`                 | [film-player](/docs/film-player) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/choreo-player/src/index.ts) |
| `ChoreoPlayer`              | [film-player](/docs/film-player) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/choreo-player/src/index.ts) |
| `ChoreoPlayerUpdateOptions` | [film-player](/docs/film-player) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/choreo-player/src/index.ts) |
| `ChoreoPlayerOptions`       | [film-player](/docs/film-player) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/choreo-player/src/index.ts) |
| `createChoreoPlayer`        | [film-player](/docs/film-player) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/choreo-player/src/index.ts) |

### ChoreoContext

| API             | Guide                                                          | Source                                                                                                 |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `c.Aim`         | [spatial-frame](/docs/spatial-frame)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Attach`      | [film-attachments](/docs/film-attachments)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Camera`      | [spatial-frame](/docs/spatial-frame)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Camera3D`    | [spatial-camera3d](/docs/spatial-camera3d)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Crossing`    | [interactive-crossings](/docs/interactive-crossings)           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Follow`      | [interactive-follow](/docs/interactive-follow)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Frame`       | [spatial-frame](/docs/spatial-frame)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Gate`        | [interactive-gates](/docs/interactive-gates)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Hold`        | [interactive-holds](/docs/interactive-holds)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Move`        | [interactive-move](/docs/interactive-move)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Pan`         | [spatial-relative](/docs/spatial-relative)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Parallel`    | [interactive-blocks](/docs/interactive-blocks)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Perform`     | [interactive-commands](/docs/interactive-commands)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Raise`       | [interactive-raise-scroll](/docs/interactive-raise-scroll)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Scroll`      | [interactive-raise-scroll](/docs/interactive-raise-scroll)     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Sequence`    | [interactive-blocks](/docs/interactive-blocks)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.SlowZoom`    | [spatial-relative](/docs/spatial-relative)                     | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Spring`      | [interactive-property-steps](/docs/interactive-property-steps) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Tether`      | [interactive-tethers](/docs/interactive-tethers)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Tween`       | [interactive-property-steps](/docs/interactive-property-steps) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.Wait`        | [interactive-holds](/docs/interactive-holds)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.advance`     | [interactive-gates](/docs/interactive-gates)                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.all`         | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.beacon`      | [interactive-beacons](/docs/interactive-beacons)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.camera`      | [spatial-frame](/docs/spatial-frame)                           | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.counterpart` | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.gesture`     | [core-drag](/docs/core-drag)                                   | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.id`          | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.inserted`    | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.kept`        | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.moved`       | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.onstage`     | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.received`    | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.removed`     | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.role`        | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.run`         | [interactive-run](/docs/interactive-run)                       | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |
| `c.still`       | [interactive-queries](/docs/interactive-queries)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts) |

### FilmVocabulary

| API          | Guide                                                  | Source                                                                                                          |
| ------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `f.Attach`   | [film-media-graph](/docs/film-media-graph)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Chapter`  | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Eye`      | [film-poses](/docs/film-poses)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Freeze`   | [film-media-graph](/docs/film-media-graph)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Insert`   | [film-media-graph](/docs/film-media-graph)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Inset`    | [film-media-graph](/docs/film-media-graph)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Join`     | [film-joins](/docs/film-joins)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Lineup`   | [film-world-annotations](/docs/film-world-annotations) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Mark`     | [film-world-annotations](/docs/film-world-annotations) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Sequence` | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Shot`     | [film-poses](/docs/film-poses)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Sky`      | [film-world-annotations](/docs/film-world-annotations) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Spine`    | [film-graph](/docs/film-graph)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Stamp`    | [film-world-annotations](/docs/film-world-annotations) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.To`       | [film-poses](/docs/film-poses)                         | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Trace`    | [film-world-annotations](/docs/film-world-annotations) | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Type`     | [film-typography](/docs/film-typography)               | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Video`    | [film-media-graph](/docs/film-media-graph)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.Voice`    | [film-audio-mix](/docs/film-audio-mix)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.clip`     | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.picture`  | [film-adjustments](/docs/film-adjustments)             | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
| `f.sound`    | [film-audio-mix](/docs/film-audio-mix)                 | [Implementation](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/film/graph/host.gts) |
