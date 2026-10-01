# Build Your First Spatial Scene

This tutorial puts a working HTML card into perspective and gives its orientation to Choreo. It deliberately uses one plane and CSS perspective: no model download, WebGL renderer, lighting system, or gallery infrastructure is required. You can isolate the camera contract before combining it with a device mockup.

## Run the example

Generate the application in [Build Your First Choreo Application](/docs/core-first-app), then open http://localhost:4600/spatial. The complete implementation is app/components/spatial-card.gts. Click Toggle perspective, then click the count button on the angled card. The number should update without flattening the card or resetting its pose. Both buttons are keyboard accessible because they remain ordinary HTML controls.

The example has two kinds of state. The application owns the count and whether the card should be angled. Choreo owns the interpolated camera pose. A host callback receives that pose and converts it to a CSS transform. Keep those responsibilities explicit: changing the count should not start a separate camera animation.

## Supply a camera host

The region accepts an initial pose through camera3dFrom and publishes samples through onCamera3D. The camera step declares the target yaw and pitch. A toggle changes the target; it does not create a timer that guesses when the last movement finished.

```gts title="SpatialCard — camera excerpt"
<Choreo @camera3dFrom={{this.camera}} @onCamera3D={{this.receive}} as |c|>
  <!-- The stage and live card are rendered here. -->
  <c.Camera3D
    @yaw={{this.targetYaw}}
    @pitch={{if this.angled 12 0}}
    @duration={{0.7}}
  />
</Choreo>
```

Import Choreo, motion, and Camera3DState from glimmer-motion. The full component defines the callback, initial state, target getter, and stage. The initial camera object stays stable; the callback updates a separate pose field. Feeding each sample back as a new initial state would blur the ownership of the animation.

## Map pose to a plane

CSS perspective belongs to the containing stage. The card has a transform origin at its center. This host negates yaw and pitch when rotating the plane: turning the view right means the subject appears to turn left. The scale is the inverse of dolly, so a larger camera distance produces a smaller subject.

```ts title="SpatialCard — host mapping excerpt"
const { yaw, pitch, dolly } = this.pose;
return htmlSafe(
  `transform: rotateX(${-pitch}deg) rotateY(${-yaw}deg) scale(${1 / dolly});`,
);
```

This is a deliberately small interpretation of the camera pose, not a full perspective-camera renderer. It does not implement world translation, a look target, depth-tested occlusion, or a WebGL camera matrix. The stage participant and the transformed card are separate elements: the card's bound CSS style does not compete with a motion modifier on that same element. htmlSafe is used only for numbers produced by this component, never for untrusted CSS strings.

## Make one prediction at a time

Set yaw to 45 degrees and toggle perspective. Predict which edge appears closer before clicking. Change yaw while the card is angled and check that the camera redirects toward the new value. Toggle back before it settles; the card should return continuously. Now click Count several times while it moves. Application state should remain independent of camera state.

Try the browser's reduced-motion preference and repeat. The example uses the library's normal policy; it does not opt out to preserve a dramatic camera move. Check a narrow viewport too. A useful spatial demo still needs a readable close view and sufficient room for expanded content.

## Grow beyond one card

When adding a real 3D device, share the renderer's projection and object matrices with the DOM plane. The CSS mapping in this small study is not a shortcut for aligning an arbitrary mesh screen. [Keeping the interface live](/docs/spatial-dom) explains that next boundary, and Mockup is the larger reference implementation.

Before adding assets, keep this example's useful checks: the visible button and its hit target agree after movement, changing application state does not reset the camera, resizing does not clip essential controls, and leaving the route stops its work. The browser verification command in the first tutorial checks that the angled button remains usable and that the transition changes the plane transform.

The complete source is [spatial-card.gts](https://github.com/cardstack/choreo/blob/main/test-app/app/components/tutorials/spatial-card.gts). Once that host boundary is clear, continue to [recording a scene](/docs/film-first-export) to learn how an external clock can request completed frames.
