# Host Adapters and the Render Pipeline

Most applications should use the modifier and components. A new Glimmer host or specialized renderer needs a deeper boundary: constructing motion nodes, scheduling work after render, and preserving measurement order. The exported host APIs exist for that integration, not as extra animation commands to sprinkle through ordinary components.

## Owning an Element Lifecycle

`MotionNode` represents the lifecycle glue for one HTML or SVG element. `MotionProps` describes its engine-facing properties, and `MotionEl` describes the supported DOM element shape. The `MotionModifier` is the Ember modifier shell that connects this model to Glimmer. A host adapter must construct, update, and tear down nodes in the order expected by the engine.

The binding queues initial mounts because Glimmer installs child modifiers before parent modifiers. `flushPendingMounts()` builds the required tree relationship and completes the pending work. Calling it at an arbitrary point inside another render is not a safe shortcut: a child may otherwise miss its parent's variants, presence, or configuration.

## Scheduling After Render

`postRender()` is the common scheduling boundary, and `setPostRender()` installs a host implementation. The callback must run after the relevant render pass has committed. It should not be replaced with an arbitrary timeout whose delay merely appears to work on one device.

The layout pipeline follows a specific order:

```text title="Rendering contract"
snapshot old bounds
→ commit the DOM change
→ finish pending mounts
→ measure new bounds
→ settle projection
```

`snapshotAll()` captures projection state; `requestSettle()` requests the coordinated post-render measurement; `afterSettle()` schedules work after that pipeline. `layoutChange()` is the ordinary application-facing wrapper for a state change outside an observing layout group. `instantLayoutTransition()` is a special control for landing a layout update without animation.

## Detecting Integration Failures

`layoutLoopDetected()` and `resetLayoutLoopGuard()` support diagnostics and test cleanup. The guard detects a burst of repeated settlement without an intervening browser frame. It keeps the page responsive enough to diagnose the problem, but a tripped guard still means the application or adapter has a feedback loop.

A common trigger is assigning a tracked property unconditionally from a per-frame callback, which causes another render, another measurement, and another callback. Guard meaningful state changes and let MotionValues carry continuous visual values.

Test a new adapter with nested motion elements, shared layout, an exiting child, and interruption. A single successful opacity animation does not validate mount ordering or projection. The existing fidelity and contract suites are the relevant evidence because they exercise the temporal behavior that a host integration can silently change.

## API Coverage

**glimmer-motion**: `afterSettle`, `instantLayoutTransition`, `layoutLoopDetected`, `requestSettle`, `resetLayoutLoopGuard`, `snapshotAll`, `MotionEl`, `MotionModifier`, `flushPendingMounts`, `MotionNode`, `postRender`, `setPostRender`.

Read the implementation: [`layout.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/layout.ts), [`motion.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/motion.ts), [`node.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/node.ts), [`scheduler.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/scheduler.ts).
