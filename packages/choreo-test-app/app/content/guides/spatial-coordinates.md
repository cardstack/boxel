# Plane Coordinates and Hit Testing

A live card can occupy one coordinate system for layout and another for presentation. When a camera scales or pans its plane, the host must convert geometry and input consistently. `appliedCamera`, `toPage`, and `toLocal` expose the arithmetic used for Choreo's two-dimensional plane camera.

## Applying the Camera

The camera stores x, y, and zoom, with an optional aim point. Zooming around that aim changes the translation actually applied to the plane. `appliedCamera(camera, aim)` computes that translation; callers should not use the raw x and y as though the aim term did not exist.

```ts title="Component logic excerpt"
import { toLocal, toPage } from 'glimmer-motion';

const camera = { x: 20, y: 10, zoom: 2 };
const local = { x: 30, y: 40, width: 100, height: 50 };
const projected = toPage(local, camera);
const restored = toLocal(projected, camera);
```

With matching aim and scroll arguments, converting to page space and back reconstructs the original rectangle. `PlanePoint` describes the x/y arguments and `Rect` describes the boxes. A zero zoom cannot be inverted, so the host must keep its camera in a meaningful valid range.

## Accounting for Scroll and Origins

The helpers include a scroll offset in the plane calculation. They do not discover arbitrary ancestor transforms or a host's external placement automatically. When a plane sits inside another positioned surface, compose that placement at the boundary rather than assuming this camera-only conversion is a complete browser-to-world matrix.

The distinction between local, parent, page, viewport, and 3D world space should be explicit in variable names and function boundaries. Many doubled-scale bugs come from applying a conversion to a rectangle that was already transformed. Read the captured bounds' documented space before using them as an input.

## Connecting Input to Presentation

For drag events under transformed parents, use the pointer correction helpers described in the core section. For a WebGL-backed DOM plane, the renderer must additionally use its camera and object matrices to align the plane with the drawn geometry. The two-dimensional helpers are not a general perspective projection API.

Test round trips as arithmetic, then test the visible interface under the actual nested camera and scroll configuration. An arithmetic identity test alone cannot prove that the host supplied the correct origin. Click all corners of the projected card, open its expanded state, and repeat after a camera move. The view and its hit targets should share the same transformation, with each conversion performed once at a clearly owned boundary.

## API Coverage

**glimmer-motion**: `PlanePoint`, `appliedCamera`, `toLocal`, `toPage`, `Rect`.

Read the implementation: [`space.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/space.ts), [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts).
