# Relative Pans and Slow Zooms

A held shot can remain visually alive without changing its subject. A slight push toward a detail or a small pan across a layout can direct attention while preserving the viewer's orientation. `c.Pan` and `c.SlowZoom` express these relative moves using the same camera clock as the preceding shot.

## Moving From Here

Pan adds a translation to the camera pose in force when its cue starts. SlowZoom multiplies the existing zoom while retaining the current aim. These operations differ from setting an absolute x, y, or zoom target, which would erase the framing established by an earlier step.

```gts title="Component template excerpt"
<c.Sequence>
  <c.Frame @of={{c.id 'hero'}} @padding={{0.8}} @duration={{0.6}} />
  <c.Pan @x={{24}} @y={{-12}} @duration={{1.2}} />
  <c.SlowZoom @by={{1.05}} @duration={{2}} />
</c.Sequence>
```

The final move increases magnification by five percent relative to the pose already established. A multiplier below one pulls back. Small values often work better for reading shots because the viewer can continue looking at the same content while the frame changes gently.

## Keeping Relative Work Seekable

The compiler and run resolve relative operations against the preceding authored pose. They do not simply add a little translation on every browser frame. That distinction makes it possible to reconstruct a paused still without accumulating a different position each time the same timestamp is visited.

Do not reproduce the relative movement in a host callback by incrementing a camera field on every update. That adds a second stateful motion path and makes seeking depend on how many frames were rendered. The host should apply the result of the score rather than integrate it again unless the experience deliberately chooses a live chase model.

## Choosing Timing

A relative move accepts the ordinary timing controls and can use a duration with easing or a spring. For a reading interval, choose enough time that the movement supports attention rather than making text harder to follow. A long zoom is not a substitute for a clear initial fit; first establish the subject, then add the smaller continuation.

Test a relative step after more than one possible preceding frame. The benefit of the operation is that it composes with where the camera stands, so it should not only work after one hard-coded pose. Also test a direct seek into the middle of the relative move and a backward seek across its start. The same time should give the same camera state when the score uses an exact clock-based path.

## API Coverage

**ChoreoContext**: `c.Pan`, `c.SlowZoom`.

Read the implementation: [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
