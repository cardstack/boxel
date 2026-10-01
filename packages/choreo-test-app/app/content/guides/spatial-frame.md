# Framing and Aiming a DOM Camera

A spatial explanation starts by making the subject easy to see. Choreo's two-dimensional camera moves the region's real DOM frame, so an interface can be reframed without becoming a screenshot. `c.Camera`, `c.Frame`, and `c.Aim` express different ways to choose that frame.

## Setting the Camera Directly

`c.Camera` accepts zoom and translation values, with an optional origin query that identifies the point around which the zoom is aimed. It can also fit a query into the available frame. The resulting `CameraState` is a two-dimensional pose; it is not a WebGL projection matrix.

```gts title="Component template excerpt"
<c.Sequence>
  <c.Frame @of={{c.id 'hero'}} @padding={{0.8}} @duration={{0.6}} />
  <c.Aim @of={{c.id 'detail'}} @duration={{0.4}} />
</c.Sequence>
```

`c.Frame` computes a fit and center from the subject's measured geometry. Its padding argument is the share of the frame the subject should fill on the limiting axis, rather than a pixel inset. Passing a null fit returns to the rest framing. `c.Aim` recenters the subject while preserving the zoom already in force.

## Choosing the Editorial Intent

Use Frame when changing the scale of attention is part of the explanation: a gallery overview becomes a readable card. Use Aim when two subjects should be compared at the same magnification. Unintentionally fitting each target can make the second subject appear to change size just because its bounding box differs.

`@steady` identifies participants that should retain their apparent size against camera movement. This can be useful for labels or chrome, but verify the complete composition. Too many size-compensated elements can obscure the spatial relationship the camera was meant to explain.

## Reading Camera State

`c.camera` exposes the camera state when a step lands or is canceled. It is deliberately not a tracked update on every frame. Application logic can respond to a settled zoom threshold without causing a render loop while the camera moves. For continuous renderer output, use the appropriate camera callback or composed values rather than turning that resting state into a frame subscription.

## Testing the View

Measure the subject in its real expanded layout. A card that fits when collapsed may clip controls when opened. Test the frame under an outer transform and after scrolling, then interrupt one framing move with another. The landing should preserve legibility, the journey should preserve identity, and the controls should remain usable throughout. Use the Camera demo to compare fit, aim, and the relative directions introduced in the next guide.

## API Coverage

**glimmer-motion**: `CameraState`.

**ChoreoContext**: `c.Aim`, `c.Camera`, `c.Frame`, `c.camera`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
