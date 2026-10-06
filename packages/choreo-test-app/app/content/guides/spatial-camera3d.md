# The Camera3D Renderer Contract

Choreo does not create a 3D renderer. It directs camera values over time and hands the resulting pose to the host. This boundary lets the same timeline work with a Three.js scene, a CSS 3D environment, or another renderer without embedding that renderer's object model in the animation language.

## Receiving a Pose

A region's `@onCamera3D` callback receives a `Camera3DState` when the score changes the pose. A camera step can direct yaw, pitch, dolly, translation, and an optional look center. Yaw and pitch are degrees; x and y represent truck and pedestal relative to the host's framing convention; look uses the host's scene units.

```gts title="Component template excerpt"
<Choreo @camera3dFrom={{opening}} @onCamera3D={{this.applyPose}} as |c|>
  <i {{motion id='rig'}}></i>
  <c.Camera3D @yaw={{30}} @pitch={{12}} @dolly={{1.2}}
    @duration={{2}} @ease='linear' />
</Choreo>
```

The host's applyPose callback maps those values to its own camera. The motion participant supplies a concrete region subject for the score. Define the opening state before the first run so the camera does not travel unexpectedly from the library's default pose into an already-seated scene.

## Keeping the Boundary Honest

Dolly is a framing multiple interpreted by the host, not a universal world-space distance. Document whether a larger value increases magnification in your renderer. Similarly, moving the look center changes the subject of an orbit, so it must be part of the scored pose rather than a separate event handler that eases toward a new center on its own clock.

`@by` expresses a relative camera change. `@through` provides a waypoint path for a longer tour. These are different authoring shapes over the same pose contract; the renderer should not need a separate scheduler for each one.

## Applying Without Feedback

The callback should apply the supplied pose and render the corresponding view. Avoid writing tracked state unconditionally on every callback if that state causes the score to recompile. Renderer-owned fields can receive continuous values directly, while application state changes remain discrete.

Verify a cold start, a paused midpoint, a direct seek, and an interrupted target. Also compare DOM hit targets with the rendered scene if the camera reveals live controls on a plane. A camera that looks smooth while its pointer mapping drifts is not a correct spatial interface. Lighting, geometry, occlusion, and asset readiness remain renderer responsibilities, even though their presentation may be coordinated by the same tour.

## API Coverage

**@cardstack/choreo**: `Camera3DState`.

**ChoreoContext**: `c.Camera3D`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
