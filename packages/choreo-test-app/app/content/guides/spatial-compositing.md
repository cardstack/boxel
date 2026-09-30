# DOM and WebGL Compositing

A live interface does not need to be painted into a texture to appear inside a 3D environment. The mockup and gallery examples combine WebGL geometry with DOM placed through the same projection. This keeps text and controls in the browser's native interface system while the surrounding scene supplies depth, lighting, and atmosphere.

## Sharing One Projection

The renderer computes a transform for the DOM surface using the same camera and object geometry that defines its visible frame. The DOM is then composited at that position rather than captured as a new screenshot on every update. This approach can preserve real inputs, text selection, and component state.

```text title="Rendering contract"
camera + object transform
        ├─ WebGL frame geometry
        └─ projected DOM surface
                 └─ ordinary Glimmer component
```

The two branches must agree on dimensions, origin, orientation, and depth ordering. A convincing frame with a slightly misaligned interface still fails when a user tries to press a control near its edge. Read the mockup and long-take implementations together: one places the screen in a device, while the other also directs a camera within the screen's content.

## Understanding Occlusion

DOM and WebGL do not automatically share a depth buffer. The host needs a deliberate compositing strategy for which surface appears in front and which part of the canvas exposes the DOM. A plane is not automatically occluded by every arbitrary 3D object simply because their coordinates agree.

This limitation influences scene design. Framed planar exhibits are a good fit; dense overlapping solid objects with complex interpenetration demand more work. Choose the geometry and camera route so the intended layering remains explainable and testable.

## Preserving Readability

Allocate the surface at a useful CSS size, including its expanded content. At the close reading pose, aim for a presentation scale that lets the browser render text cleanly rather than compensating for an undersized card with an enormous transform. Device pixel ratio, perspective, and the browser's compositor can still affect rasterization, so inspect the actual target device.

## Managing Activation

A large gallery may use pre-rendered previews for inactive exhibits and mount the live component near the reading pose. Keep the preview until the incoming interface and its required assets have painted. A load event for an outer iframe does not always mean the nested renderer is ready.

Use fewer live renderers where necessary, but do not treat a preview as the only architecture available. Documentation pages with a few examples can mount them immediately. The right budget depends on how many independent animation loops, canvases, and decoded assets compete for the browser's frame, not just the number of visible tiles.
