# Keeping the Interface Live

A demo inside a 3D device can remain a real interface. The browser still lays out the text and controls; a transform places that DOM plane where the device's screen belongs.

## Sharing the Projection

The examples use the same camera and object matrices for the WebGL picture and the DOM plane. Three small functions in `test-app/app/lib/css3d.ts` provide the CSS projection and transforms.

```ts title="Projection Helpers — Existing Host Excerpt"
const focal = perspective(camera.projectionMatrix.elements, viewportHeight);
const view = cameraCss(
  camera.matrixWorldInverse.elements,
  focal,
  viewportWidth,
  viewportHeight,
);
const plane = objectCss(screen.matrixWorld.elements);
```

This excerpt assumes a renderer has already created `camera` and `screen`, and that the three helpers have been imported from the application's `css3d` module. These helpers belong to the demo host, not a separate DOM renderer exported by the motion package.

Glimmer owns the subtree and its updates. The 3D renderer owns its scene, lighting, and model. Keeping those responsibilities separate makes it possible to reuse the same application component in a flat page and a spatial frame.

## Preserving Readability

Choose the plane's layout dimensions based on the component's largest useful state. Menus, expanded cards, and tool panels need room before the camera approaches. Arbitrarily stretching a screenshot of a small component will not produce crisp text.

At a close reading position, aim for a useful native CSS scale. Inspect the result at the target device pixel ratio; perspective transforms and browser compositing still affect the final rasterization.

## Testing Interaction

Check a real control after moving the camera. Its visible position and hit target must agree. Test scrolling, dragging, and keyboard focus, as well as ordinary clicks. If a model should obscure part of the screen, verify that the visual and input behavior agree about that overlap.

The [long take demo](/long-take) combines a device view with a live screen. The [DOM in 3D reference](https://github.com/cardstack/choreo/blob/main/docs/dom-in-3d.md) explains the projection and occlusion decisions in more detail.

Check the relationship after a viewport resize as well as a camera move. Both the renderer projection and the DOM plane dimensions need to reflect the new frame before the next interaction.
