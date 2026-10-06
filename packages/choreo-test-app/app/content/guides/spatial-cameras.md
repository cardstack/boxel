# Directing a 3D Camera

A camera changes what the viewer can see without changing the application itself. In a spatial scene, a useful camera move introduces a subject, makes its controls readable, and leaves enough time to understand the result of an interaction.

## Describing a Pose

Choreo's `Camera3D` step describes an orbit-style camera in terms of framing. `dolly` adjusts distance relative to the host's framing. `yaw` and `pitch` are angles in degrees. `x` and `y` move the framing horizontally and vertically.

```gts title="A Camera Sequence — Template Excerpt"
<Choreo @onCamera3D={{this.applyPose}} as |c|>
  <i {{motion id="rig"}}></i>
  <c.Sequence>
    <c.Camera3D
      @dolly={{0.6}}
      @yaw={{-18}}
      @pitch={{12}}
      @duration={{2.4}}
      @ease="easeInOut"
    />
    <c.Camera3D @by={{true}} @x={{0.08}} @duration={{2.1}} @ease="linear" />
  </c.Sequence>
</Choreo>
```

Import `Choreo` from `@cardstack/choreo` and `motion` from `glimmer-motion`. The host supplies `applyPose`, which applies the emitted pose to its renderer. This excerpt describes camera direction; it does not construct a WebGL scene.

The second step uses `@by={{true}}` to move relative to the pose already in force. Without that relationship, independently authored moves can unexpectedly replace one another's framing.

## Choosing a Subject

Frame the control the viewer needs to inspect, not just the center of the model. If a card expands, account for the expanded bounds when choosing the camera stop. A visually attractive wide view is rarely the right distance for reading small interface text.

Use the [mockup](/mockup) to compare a device view with its interactive screen. The [camera example](/camera) introduces framing and subject changes in a simpler scene.

## Keeping One Camera Clock

Let the Choreo run evaluate the camera movement and have the renderer consume the result. Avoid accumulating a separate camera offset on every animation frame; accumulation makes seeking depend on playback history.

For films, choose exact seeking when the requested frame must be reproducible. A chased camera can suit live playback, but its state needs explicit handling at a cut. The [Film guide](/docs/film-shots) explains that distinction.

## Choosing a More Specific Direction

The spatial section now separates fitting and aiming, relative pans and zooms, the Camera3D renderer contract, waypoint paths and smoothing, and coordinate conversion. Those operations deserve separate decisions in a real tour. First establish the frame that makes the subject readable. Then choose whether the following movement is a new absolute view or a continuation from the current pose. Check the same sequence through direct seeking as well as ordinary playback.
