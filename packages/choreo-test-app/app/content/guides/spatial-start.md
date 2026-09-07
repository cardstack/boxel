# Spatial & 3D Choreo

A spatial interface can keep its buttons, text, and layout as real DOM. A camera transform places that interface in a three-dimensional scene. This lets you reuse an existing Glimmer component while changing how the viewer approaches it.

## Motivation

Some ideas are easier to understand in space. A device mockup explains how an interface fits its hardware; a gallery lets people compare capabilities; a camera can direct attention while preserving the relationship between subjects.

Use 3D when those spatial relationships help the viewer. Keep the application live so approaching an exhibit leads naturally into using it, and make the reading view as carefully as the wide view.

## Learning Goals

By the end of this section, you will be able to:

- Direct a camera with Choreo while leaving rendering to the host.
- Place live DOM on a plane that shares the scene's projection.
- Keep text, expanded layouts, and interaction targets usable at close range.
- Organize exhibits into a room with readable signs and purposeful camera routes.
- Budget active rendering work and transition from a preview to a live interface.

## Separating Content from the Camera

In Choreo's mockup demos, a WebGL scene draws the device and a DOM plane supplies its screen. The screen's transform is calculated from the same camera and object matrices as the model. The application remains interactive because its controls are still HTML elements.

Choreo's `c.Camera3D` directs camera values through the timeline. The renderer consumes those values; it continues to own lighting, geometry, and projection. This boundary lets a camera movement be paused or sought without introducing a second animation loop for the shot.

Open the [mockup demo](/mockup) and switch to 3D to see the screen remain live as the device moves. The [DOM in 3D reference](https://github.com/cardstack/choreo/blob/main/docs/dom-in-3d.md) explains the matrix mapping used by the examples.

## Exploring the Gallery

The [3D gallery](/_widgets) arranges the demos as framed exhibits. Its guided tour connects traditional interface motion, spatial interaction, and film direction in one room.

Each exhibit needs enough layout space for its expanded state. Measure the demo at its largest useful size before choosing the frame; shrinking every component into the same tile can clip menus and make text difficult to read.

## Managing Work Outside the Active View

Many live interfaces in one scene can compete for the same browser frame budget. The gallery uses prepared previews for inactive exhibits and activates the focused demo. A preview should remain visible until the replacement has actually rendered, including any required model or texture.

This is a gallery performance strategy, not a requirement of the core motion library. A smaller room may keep more content live. Profile on the device that will show the experience and check the transition into an exhibit as carefully as the camera movement.

Continue with [Directing a 3D Camera](/docs/spatial-cameras), [Keeping the Interface Live](/docs/spatial-dom), and [Building a Spatial Gallery](/docs/spatial-gallery). When the camera and interaction need to follow a repeatable presentation, continue with [Recorded & Film Choreo](/docs/film-start).
