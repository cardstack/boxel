# Camera Paths, Cuts, and Smoothing

A tour made from many independent camera moves can feel as if it brakes at every exhibit. A waypoint path lets the camera move through a sequence of authored poses on one clock. Choreo adds path tension, explicit cuts, and a clock-based smoothing window so continuity and deterministic rendering can coexist.

## Authoring Waypoints

Pass `Camera3DWaypoint` values through `@through`. Omitted pose fields carry forward from the preceding pose. The camera samples a spline through these poses over the step's duration, so waypoint spacing in time and changes in pose determine the apparent speed.

```gts title="Component template excerpt"
<c.Camera3D @through={{tourPath}} @duration={{12}}
  @ease='linear' @tension={{0.34}} @settle={{0.5}} />
```

A waypoint with `cut=true` begins a new shot. The path is split at that point rather than interpolating through the discontinuity. A cut on the first waypoint can remove the initial pose-in-force seed, allowing the sequence to open directly in its first authored shot. Keep these cuts aligned with the narrative and any media changes.

## Tension and Smoothing

Tension changes the grip of the path between waypoints. Settle is a separate smoothing window measured in seconds on the cue's clock. It averages the path around the current time to soften changes in curvature. Because it samples a function of time, it can preserve exact seeking without retaining a previous-frame velocity.

A half-second settle is a useful starting point when waypoint intervals are around two seconds, not a universal flag that improves every path. Keep the window substantially shorter than the time between meaningful poses. Too much averaging can prevent the camera from visiting the views the author intended. The window tapers at cuts and endpoints so a hard edit stays hard and the final pose remains exact.

## Comparing With a Spring Chase

Two cascaded spring stages can produce a pleasing live camera response, but they keep state from earlier frames. Reaching the same target time directly does not necessarily reproduce the pose reached by playing there. For a rendered film, use the exact path smoother or a deliberately controlled simulation reconstruction.

Review the result at the distribution frame rate. Check velocity and curvature through ordinary waypoints, then inspect the frames around each cut separately. A low average frame time does not rule out a visible camera tick. Finally, test direct random-access samples and repeated seeks to the same time. Smoothing should improve the journey while preserving the authored composition and the clock contract.

## API Coverage

**@cardstack/choreo**: `Camera3DWaypoint`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts).
