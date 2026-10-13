# API and Concept Inventory

Choreo has four connected areas: an element binding over Motion, interactive scene choreography, spatial direction, and recorded film composition. This inventory maps the public entrypoints and yielded vocabularies to the guides that explain their behavior. Use it when you know an API name, when you are planning an application, or when you want to check whether a concept has been documented beyond an introductory example.

## Scope and Reading Depth

The inventory covers the `glimmer-motion` root and its `glimmer-motion/test-support` subpath, the `@cardstack/choreo` root and its `@cardstack/choreo/film` and `@cardstack/choreo/test-support` subpaths, and the separate `@cardstack/choreo-player` package. It also includes the components and queries yielded by ChoreoContext and FilmVocabulary. Each entry links to a substantial concept chapter with motivation, behavior, examples, and relevant constraints.

Related helpers, compatibility aliases, and supporting TypeScript types share the chapter about the behavior they describe. For example, a spring configuration and its argument type belong with spring transitions; the several query selectors belong with the changeset model. This avoids pretending that a type alias is an independent feature while still making every exported name discoverable.

Each guide contains at least 300 words of explanatory prose, approximately three-quarters of a conventional documentation page, excluding code blocks and API tables. This is a minimum depth check rather than a measure of completeness by itself. Complex concepts include additional examples and links to adjacent contracts. A longer page should add useful explanation, not repeat the same introduction in different words.

## Implementation and Integration Boundaries

The inventory reflects the checked-in implementation. Historical design notes can include proposals or older signatures, so the source links beside an API are the authority for its current shape. Advanced host APIs and the external-provider lane surface are identified as integration work rather than required application patterns. Wildcard deep imports expose implementation modules, but the inventory does not promise every internal helper as a supported standalone application API.

The library uses the engine's own MotionValues. `glimmer-motion` re-exports a small, curated set of engine functions (`motionValue`, `transformValue`, `styleEffect`, `frame`, `animate`) rather than wrapping them, and the continuous-value guide explains that integration. Similarly, the spatial guides distinguish camera direction from renderer capabilities, and the film guides distinguish a compiled graph from decoded, paintable media. Those boundaries are part of learning the system, not details to skip when assembling a demonstration.

## Maintaining Coverage

Run `pnpm lint:realm` in `packages/choreo-gallery` after changing an export or a guide. The check compares this inventory with the actual source declarations, verifies guide destinations and preambles, and enforces the minimum prose depth. A new public symbol fails that check until its documentation mapping is reviewed. Browser verification still matters for examples, controls, and renderer behavior; a coverage table alone cannot prove that a demonstration works.

## Find an API

### glimmer-motion

| API                          | Guide                                             | Source                                                                                                                      |
| ---------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `BusyProbe`                  | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/activity.ts)                      |
| `registerBusyProbe`          | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/activity.ts)                      |
| `scroll`                     | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `scrollInfo`                 | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `ScrollInfo`                 | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `ScrollOffset`               | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `ScrollOptions`              | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `InViewOptions`              | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `inView`                     | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `createDragControls`         | [core-drag-handles](core-drag-handles.md)         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/gestures/drag-controls.ts)        |
| `DragControls`               | [core-drag-handles](core-drag-handles.md)         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/gestures/drag-controls.ts)        |
| `correctParentTransform`     | [core-drag-handles](core-drag-handles.md)         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/gestures/transform-page-point.ts) |
| `transformViewBoxPoint`      | [core-drag-handles](core-drag-handles.md)         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/gestures/transform-page-point.ts) |
| `InertiaArgs`                | [core-drag](core-drag.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `SpringArgs`                 | [core-springs](core-springs.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `TweenArgs`                  | [core-tweens](core-tweens.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `ease`                       | [core-tweens](core-tweens.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `inertia`                    | [core-drag](core-drag.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `perValue`                   | [core-targets](core-targets.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `spring`                     | [core-springs](core-springs.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `stagger`                    | [core-variants](core-variants.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `styles`                     | [core-targets](core-targets.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `to`                         | [core-targets](core-targets.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `tween`                      | [core-tweens](core-tweens.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/helpers.ts)                       |
| `afterSettle`                | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `instantLayoutTransition`    | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `layoutChange`               | [core-layout](core-layout.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `layoutLoopDetected`         | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `requestSettle`              | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `resetLayoutLoopGuard`       | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `snapshotAll`                | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/layout.ts)                        |
| `closestLayoutGroup`         | [core-layout](core-layout.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/layout-group.gts)                 |
| `LayoutGroup`                | [core-layout](core-layout.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/layout-group.gts)                 |
| `snapshotOnRender`           | [core-layout](core-layout.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/layout-group.gts)                 |
| `MotionEl`                   | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/motion.ts)                        |
| `MotionProps`                | [core-elements](core-elements.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/motion.ts)                        |
| `motion`                     | [core-elements](core-elements.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/motion.ts)                        |
| `MotionModifier`             | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/motion.ts)                        |
| `MotionConfigContext`        | [core-config](core-config.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/motion-config.gts)                |
| `closestMotionConfig`        | [core-config](core-config.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/motion-config.gts)                |
| `MotionConfig`               | [core-config](core-config.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/motion-config.gts)                |
| `flushPendingMounts`         | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/node.ts)                          |
| `MotionNode`                 | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/node.ts)                          |
| `MotionParticipant`          | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/participant.ts)                   |
| `ParticipantArgs`            | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/participant.ts)                   |
| `ParticipantHost`            | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/participant.ts)                   |
| `closestParticipantHost`     | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/participant.ts)                   |
| `defineParticipantArg`       | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/participant.ts)                   |
| `PARTICIPANT_HOST_ATTRIBUTE` | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/participant.ts)                   |
| `setParticipantHost`         | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/participant.ts)                   |
| `Presence`                   | [core-presence](core-presence.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/presence.gts)                     |
| `PresenceHandle`             | [core-presence](core-presence.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/presence-types.ts)                |
| `ReorderGroup`               | [core-reorder](core-reorder.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/reorder/group.gts)                |
| `ReorderItem`                | [core-reorder](core-reorder.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/reorder/item.gts)                 |
| `ReorderAxis`                | [core-reorder](core-reorder.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/reorder/types.ts)                 |
| `ReorderContextProps`        | [core-reorder](core-reorder.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/reorder/types.ts)                 |
| `postRender`                 | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scheduler.ts)                     |
| `setPostRender`              | [core-host](core-host.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scheduler.ts)                     |
| `ScrollValues`               | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `UseInViewOptions`           | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `UseScrollOptions`           | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `InView`                     | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `scrollProgress`             | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `useInView`                  | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `useScroll`                  | [core-scroll](core-scroll.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/scroll.ts)                        |
| `motionSpeed`                | [core-tempo](core-tempo.md)                       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/speed.ts)                         |
| `onMotionSpeed`              | [core-tempo](core-tempo.md)                       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/speed.ts)                         |
| `scaleTransition`            | [core-tempo](core-tempo.md)                       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/speed.ts)                         |
| `setMotionSpeed`             | [core-tempo](core-tempo.md)                       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/speed.ts)                         |
| `ViewTransitionBuilder`      | [core-page-transitions](core-page-transitions.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/view-transition.ts)               |
| `ViewTransitionOptions`      | [core-page-transitions](core-page-transitions.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/view-transition.ts)               |
| `ViewTransitionUpdate`       | [core-page-transitions](core-page-transitions.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/view-transition.ts)               |
| `animateView`                | [core-page-transitions](core-page-transitions.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/view-transition.ts)               |
| `viewTransition`             | [core-page-transitions](core-page-transitions.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/view-transition.ts)               |
| `animate`                    | [core-tweens](core-tweens.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/index.ts)                         |
| `frame`                      | [core-motion-values](core-motion-values.md)       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/index.ts)                         |
| `MotionValue`                | [core-motion-values](core-motion-values.md)       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/index.ts)                         |
| `motionValue`                | [core-motion-values](core-motion-values.md)       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/index.ts)                         |
| `styleEffect`                | [core-motion-values](core-motion-values.md)       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/index.ts)                         |
| `transformValue`             | [core-motion-values](core-motion-values.md)       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/index.ts)                         |

### @cardstack/choreo

| API                | Guide                                                       | Source                                                                                          |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `beacon`           | [interactive-beacons](interactive-beacons.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/beacon.ts)    |
| `ChoreoContext`    | [interactive-start](interactive-start.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts)   |
| `Choreo`           | [interactive-start](interactive-start.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts)   |
| `AnchorRef`        | [interactive-anchors](interactive-anchors.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/anchors.ts)   |
| `after`            | [interactive-anchors](interactive-anchors.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/anchors.ts)   |
| `at`               | [interactive-anchors](interactive-anchors.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/anchors.ts)   |
| `Arming`           | [interactive-arming](interactive-arming.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/arming.ts)    |
| `ArmingOptions`    | [interactive-arming](interactive-arming.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/arming.ts)    |
| `ArmingRegion`     | [interactive-arming](interactive-arming.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/arming.ts)    |
| `createArming`     | [interactive-arming](interactive-arming.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/arming.ts)    |
| `BeaconRef`        | [interactive-beacons](interactive-beacons.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/beacons.ts)   |
| `Changeset`        | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/changeset.ts) |
| `easeIn`           | [core-tweens](core-tweens.md)                               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/easings.ts)   |
| `easeInAndOut`     | [core-tweens](core-tweens.md)                               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/easings.ts)   |
| `easeOut`          | [core-tweens](core-tweens.md)                               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/easings.ts)   |
| `GestureRef`       | [core-drag](core-drag.md)                                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/gesture.ts)   |
| `ChoreoHost`       | [interactive-registry](interactive-registry.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/registry.ts)  |
| `choreoHostAt`     | [interactive-registry](interactive-registry.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/registry.ts)  |
| `choreoHostById`   | [interactive-registry](interactive-registry.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/registry.ts)  |
| `ChoreoProvider`   | [interactive-registry](interactive-registry.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/registry.ts)  |
| `closestChoreo`    | [interactive-registry](interactive-registry.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/registry.ts)  |
| `ChoreoRun`        | [interactive-run](interactive-run.md)                       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/run.ts)       |
| `PlanePoint`       | [spatial-coordinates](spatial-coordinates.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/space.ts)     |
| `appliedCamera`    | [spatial-coordinates](spatial-coordinates.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/space.ts)     |
| `toLocal`          | [spatial-coordinates](spatial-coordinates.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/space.ts)     |
| `toPage`           | [spatial-coordinates](spatial-coordinates.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/space.ts)     |
| `StepArgs`         | [interactive-composites](interactive-composites.md)         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/steps.gts)    |
| `StepArgsBase`     | [interactive-composites](interactive-composites.md)         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/steps.gts)    |
| `StepComponent`    | [interactive-composites](interactive-composites.md)         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/steps.gts)    |
| `toMs`             | [interactive-composites](interactive-composites.md)         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/steps.gts)    |
| `Block`            | [interactive-blocks](interactive-blocks.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `Bounds`           | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `Camera3DState`    | [spatial-camera3d](spatial-camera3d.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `Camera3DWaypoint` | [spatial-paths](spatial-paths.md)                           | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `CameraState`      | [spatial-frame](spatial-frame.md)                           | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `DeliveryBy`       | [interactive-delivery](interactive-delivery.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `DeliveryOrder`    | [interactive-delivery](interactive-delivery.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `DeriveContext`    | [interactive-follow](interactive-follow.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `Easing`           | [core-tweens](core-tweens.md)                               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `FollowSource`     | [interactive-follow](interactive-follow.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `GateNode`         | [interactive-gates](interactive-gates.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `PerformCommand`   | [interactive-commands](interactive-commands.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `PropSource`       | [interactive-property-steps](interactive-property-steps.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `PropValue`        | [interactive-property-steps](interactive-property-steps.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `Query`            | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `Rect`             | [spatial-coordinates](spatial-coordinates.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `SpringSpec`       | [core-springs](core-springs.md)                             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `Sprite`           | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `Step`             | [interactive-composites](interactive-composites.md)         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |
| `TimelineNode`     | [interactive-composites](interactive-composites.md)         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/types.ts)     |

### @cardstack/choreo/film

| API                      | Guide                                               | Source                                                                                                   |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Clip`                   | [film-clips](film-clips.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clip.gts)         |
| `ClipEnd`                | [film-clips](film-clips.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clips.ts)         |
| `ClipKind`               | [film-clips](film-clips.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clips.ts)         |
| `clipLanes`              | [film-clips](film-clips.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clips.ts)         |
| `ClipLook`               | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clips.ts)         |
| `ClipSpec`               | [film-clips](film-clips.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clips.ts)         |
| `ClipState`              | [film-clips](film-clips.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clips.ts)         |
| `clipWindow`             | [film-clips](film-clips.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clips.ts)         |
| `resolveClip`            | [film-clips](film-clips.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clips.ts)         |
| `resolveClips`           | [film-clips](film-clips.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clips.ts)         |
| `ResolvedClip`           | [film-clips](film-clips.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/clips.ts)         |
| `Film`                   | [film-start](film-start.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/film.gts)         |
| `FilmContext`            | [film-start](film-start.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/film.gts)         |
| `FilmSignature`          | [film-start](film-start.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/film.gts)         |
| `TICK`                   | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/film.gts)         |
| `Adjustment`             | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `Build`                  | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `Filter`                 | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `IFRAME_PICTURE`         | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `Light`                  | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `Look`                   | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `Mix`                    | [film-audio-mix](film-audio-mix.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `Set`                    | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `SOUND`                  | [film-audio-mix](film-audio-mix.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `Sun`                    | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `Weather`                | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `Winter`                 | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/adjust.gts) |
| `AttachNode`             | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `CompiledGraph`          | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `compileGraph`           | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `EyeNode`                | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `GraphNode`              | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `GroupNode`              | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `JoinNode`               | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `Patch`                  | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `PatchNode`              | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `ShotNode`               | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `ToNode`                 | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `VoiceNode`              | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/compile.ts) |
| `FilmGraph`              | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts)   |
| `FilmGraphSignature`     | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts)   |
| `FilmVocabulary`         | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts)   |
| `VOCABULARY`             | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts)   |
| `collectGraph`           | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Eye`                    | [film-poses](film-poses.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Freeze`                 | [film-media-graph](film-media-graph.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `GraphAttach`            | [film-media-graph](film-media-graph.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `GraphChapter`           | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `GraphInsert`            | [film-media-graph](film-media-graph.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `GraphNodeComponent`     | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `GraphProvider`          | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `GraphStamp`             | [film-world-annotations](film-world-annotations.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `JoinInto`               | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Lineup`                 | [film-world-annotations](film-world-annotations.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Mark`                   | [film-world-annotations](film-world-annotations.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `PatchComponent`         | [film-graph-extension](film-graph-extension.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Sequence`               | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Shot`                   | [film-poses](film-poses.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Sky`                    | [film-world-annotations](film-world-annotations.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Spine`                  | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `To`                     | [film-poses](film-poses.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Trace`                  | [film-world-annotations](film-world-annotations.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Type`                   | [film-typography](film-typography.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Video`                  | [film-media-graph](film-media-graph.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Voice`                  | [film-audio-mix](film-audio-mix.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/nodes.gts)  |
| `Blend`                  | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `Blur`                   | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `Dip`                    | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `Flash`                  | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `inGlass`                | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `Iris`                   | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `JOIN_SECS`              | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `Joins`                  | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `Luma`                   | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `Melt`                   | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `Presentation`           | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `PresentationComponent`  | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `PRESENTATIONS`          | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `PresentationSignature`  | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `retire`                 | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `seamShape`              | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `STILL_JOINS`            | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `Wipe`                   | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/joins.gts)        |
| `clamp01`                | [film-utilities](film-utilities.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/math.ts)          |
| `hex`                    | [film-utilities](film-utilities.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/math.ts)          |
| `lerp`                   | [film-utilities](film-utilities.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/math.ts)          |
| `luminance`              | [film-utilities](film-utilities.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/math.ts)          |
| `mmss`                   | [film-utilities](film-utilities.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/math.ts)          |
| `RAD`                    | [film-utilities](film-utilities.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/math.ts)          |
| `rgba`                   | [film-utilities](film-utilities.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/math.ts)          |
| `smooth`                 | [film-utilities](film-utilities.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/math.ts)          |
| `Captions`               | [film-typography](film-typography.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/overlays.gts)     |
| `Insert`                 | [film-typography](film-typography.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/overlays.gts)     |
| `Stamp`                  | [film-typography](film-typography.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/overlays.gts)     |
| `Track`                  | [film-typography](film-typography.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/overlays.gts)     |
| `IframePicture`          | [film-picture](film-picture.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/picture.gts)      |
| `IframePictureSignature` | [film-picture](film-picture.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/picture.gts)      |
| `PictureSpec`            | [film-picture](film-picture.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/picture.gts)      |
| `Plate`                  | [film-typography](film-typography.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/plate.gts)        |
| `Burst`                  | [film-interface](film-interface.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/player.gts)       |
| `Menu`                   | [film-interface](film-interface.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/player.gts)       |
| `MenuEntry`              | [film-interface](film-interface.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/player.gts)       |
| `PlaybarSegment`         | [film-interface](film-interface.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/player.gts)       |
| `Player`                 | [film-interface](film-interface.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/player.gts)       |
| `Rail`                   | [film-interface](film-interface.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/rail.gts)         |
| `RailMark`               | [film-interface](film-interface.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/rail.gts)         |
| `beatStart`              | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `chapterHeads`           | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `Content`                | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `contents`               | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `Cue`                    | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `cues`                   | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `joinInto`               | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `Schedule`               | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `schedule`               | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `secsBefore`             | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `tailFor`                | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `totalSecs`              | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `Waypoint`               | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `waypoints`              | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/schedule.ts)      |
| `Seam`                   | [film-seam-readiness](film-seam-readiness.md)       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/seam.ts)          |
| `EndCard`                | [film-interface](film-interface.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/titles.gts)       |
| `Gate`                   | [film-interface](film-interface.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/titles.gts)       |
| `Beat`                   | [film-poses](film-poses.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `Cam`                    | [film-poses](film-poses.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `Chapter`                | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `FilmClock`              | [film-schedule](film-schedule.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `FilmGrade`              | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `FilmHandle`             | [film-transport](film-transport.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `Join`                   | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `JoinName`               | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `LookFx`                 | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `Over`                   | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `Picture`                | [film-picture](film-picture.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `PlateMode`              | [film-typography](film-typography.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `Pt3`                    | [film-poses](film-poses.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `SeamSpec`               | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |
| `ShotState`              | [film-poses](film-poses.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/types.ts)         |

### glimmer-motion/test-support

| API                   | Guide                                       | Source                                                                                                           |
| --------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `isMotionIdle`        | [core-test-timing](core-test-timing.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/activity.ts)           |
| `whatIsBusy`          | [core-test-timing](core-test-timing.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/activity.ts)           |
| `Box`                 | [core-test-geometry](core-test-geometry.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `bounds`              | [core-test-geometry](core-test-geometry.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `shape`               | [core-test-geometry](core-test-geometry.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `boundsAndShape`      | [core-test-geometry](core-test-geometry.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `SettleOptions`       | [core-test-timing](core-test-timing.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `animationsSettled`   | [core-test-timing](core-test-timing.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `velocityOf`          | [core-test-geometry](core-test-geometry.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `setupMotion`         | [core-test-timing](core-test-timing.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `resetMotion`         | [core-test-timing](core-test-timing.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts) |
| `registerMotionReset` | [core-test-timing](core-test-timing.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/glimmer-motion/src/test-support/index.ts) |

### @cardstack/choreo/test-support

| API                  | Guide                                       | Source                                                                                                   |
| -------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `setupChoreo`        | [core-test-timing](core-test-timing.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/test-support/index.ts) |
| `advanceGate`        | [core-test-timing](core-test-timing.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/test-support/index.ts) |
| `seekTo`             | [core-test-timing](core-test-timing.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/test-support/index.ts) |
| `orphanCount`        | [core-test-geometry](core-test-geometry.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/test-support/index.ts) |
| `live`               | [core-test-geometry](core-test-geometry.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/test-support/index.ts) |
| `liveAll`            | [core-test-geometry](core-test-geometry.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/test-support/index.ts) |
| `strandedTransforms` | [core-test-geometry](core-test-geometry.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/test-support/index.ts) |

### @cardstack/choreo-player

| API                         | Guide                         | Source                                                                                             |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `ChoreoRun`                 | [film-player](film-player.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo-player/src/index.ts) |
| `ChoreoPlayer`              | [film-player](film-player.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo-player/src/index.ts) |
| `ChoreoPlayerUpdateOptions` | [film-player](film-player.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo-player/src/index.ts) |
| `ChoreoPlayerOptions`       | [film-player](film-player.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo-player/src/index.ts) |
| `createChoreoPlayer`        | [film-player](film-player.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo-player/src/index.ts) |

### ChoreoContext

| API             | Guide                                                       | Source                                                                                        |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `c.Aim`         | [spatial-frame](spatial-frame.md)                           | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Attach`      | [film-attachments](film-attachments.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Camera`      | [spatial-frame](spatial-frame.md)                           | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Camera3D`    | [spatial-camera3d](spatial-camera3d.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Crossing`    | [interactive-crossings](interactive-crossings.md)           | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Follow`      | [interactive-follow](interactive-follow.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Frame`       | [spatial-frame](spatial-frame.md)                           | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Gate`        | [interactive-gates](interactive-gates.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Hold`        | [interactive-holds](interactive-holds.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Move`        | [interactive-move](interactive-move.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Pan`         | [spatial-relative](spatial-relative.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Parallel`    | [interactive-blocks](interactive-blocks.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Perform`     | [interactive-commands](interactive-commands.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Raise`       | [interactive-raise-scroll](interactive-raise-scroll.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Scroll`      | [interactive-raise-scroll](interactive-raise-scroll.md)     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Sequence`    | [interactive-blocks](interactive-blocks.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.SlowZoom`    | [spatial-relative](spatial-relative.md)                     | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Spring`      | [interactive-property-steps](interactive-property-steps.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Tether`      | [interactive-tethers](interactive-tethers.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Tween`       | [interactive-property-steps](interactive-property-steps.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.Wait`        | [interactive-holds](interactive-holds.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.advance`     | [interactive-gates](interactive-gates.md)                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.all`         | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.beacon`      | [interactive-beacons](interactive-beacons.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.camera`      | [spatial-frame](spatial-frame.md)                           | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.counterpart` | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.gesture`     | [core-drag](core-drag.md)                                   | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.id`          | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.inserted`    | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.kept`        | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.moved`       | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.onstage`     | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.received`    | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.removed`     | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.role`        | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.run`         | [interactive-run](interactive-run.md)                       | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |
| `c.still`       | [interactive-queries](interactive-queries.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/choreo.gts) |

### FilmVocabulary

| API          | Guide                                               | Source                                                                                                 |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `f.Attach`   | [film-media-graph](film-media-graph.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Chapter`  | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Eye`      | [film-poses](film-poses.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Freeze`   | [film-media-graph](film-media-graph.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Insert`   | [film-media-graph](film-media-graph.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Inset`    | [film-media-graph](film-media-graph.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Join`     | [film-joins](film-joins.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Lineup`   | [film-world-annotations](film-world-annotations.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Mark`     | [film-world-annotations](film-world-annotations.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Sequence` | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Shot`     | [film-poses](film-poses.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Sky`      | [film-world-annotations](film-world-annotations.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Spine`    | [film-graph](film-graph.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Stamp`    | [film-world-annotations](film-world-annotations.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.To`       | [film-poses](film-poses.md)                         | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Trace`    | [film-world-annotations](film-world-annotations.md) | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Type`     | [film-typography](film-typography.md)               | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Video`    | [film-media-graph](film-media-graph.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.Voice`    | [film-audio-mix](film-audio-mix.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.clip`     | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.picture`  | [film-adjustments](film-adjustments.md)             | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |
| `f.sound`    | [film-audio-mix](film-audio-mix.md)                 | [Implementation](https://github.com/cardstack/boxel/blob/main/packages/choreo/src/film/graph/host.gts) |

---

[← Diagnose Motion Problems](core-troubleshooting.md) · [All guides](README.md) · [Targets, Styles, and Property Ownership →](core-targets.md)
