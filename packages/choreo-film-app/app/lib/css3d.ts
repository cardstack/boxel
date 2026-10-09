/**
 * The WebGL ⇄ DOM coordinate mapping, and nothing else.
 *
 * Ported from three.js's CSS3DRenderer (the same arithmetic Lume's
 * CSS3DRendererNested uses). Everything those renderers do BESIDES this —
 * a scene graph, object lifecycle, a slot-based element tree, a render
 * loop — is deliberately left behind: a Choreo plane already has a DOM
 * subtree and a clock, and what it lacks is only the transform that puts
 * that subtree where the 3D camera says it goes.
 *
 * The contract is three pure functions over column-major 4×4s (three.js
 * `Matrix4.elements` order, but a plain number[16] from any source fits):
 *
 *   perspective(projection, height)  → the container's `perspective`
 *   cameraCss(viewInverse, …)        → the camera element's transform
 *   objectCss(world)                 → one plane's transform
 *
 * No three.js import, no DOM, no state. Which is what makes it testable
 * without a browser and cheap enough to live wherever it is needed.
 */

/** column-major 4×4, as `THREE.Matrix4.elements` gives it */
export type Mat4 = ArrayLike<number>;

/** CSS serializes to a handful of digits; snap the noise to zero */
const e = (v: number): number => (Math.abs(v) < 1e-10 ? 0 : v);

/**
 * The `perspective` length, in px, that makes CSS's projection agree with
 * the WebGL camera's. It is the focal length in pixels: half the viewport
 * height divided by tan(fov/2) — which is exactly what element [5] of a
 * perspective projection matrix already holds, scaled.
 */
export function perspective(projection: Mat4, viewportHeight: number): number {
  return projection[5]! * (viewportHeight / 2);
}

/**
 * The camera element's transform. `viewInverse` is the camera's
 * `matrixWorldInverse` — the world→view matrix.
 *
 * Y is negated on the way in (WebGL counts up, CSS counts down) and the
 * result is pushed back down the Z axis by the focal length, so the CSS
 * projection plane and the WebGL near plane are the same plane. The final
 * translate moves the origin from the top-left corner to the centre,
 * where the camera looks.
 */
export function cameraCss(
  viewInverse: Mat4,
  focal: number,
  viewportWidth: number,
  viewportHeight: number
): string {
  const m = viewInverse;
  return (
    `translateZ(${focal}px)` +
    `matrix3d(${e(m[0]!)},${e(-m[1]!)},${e(m[2]!)},${e(m[3]!)},` +
    `${e(m[4]!)},${e(-m[5]!)},${e(m[6]!)},${e(m[7]!)},` +
    `${e(m[8]!)},${e(-m[9]!)},${e(m[10]!)},${e(m[11]!)},` +
    `${e(m[12]!)},${e(-m[13]!)},${e(m[14]!)},${e(m[15]!)})` +
    `translate(${viewportWidth / 2}px,${viewportHeight / 2}px)`
  );
}

/**
 * One plane's transform, from its world matrix. The Y BASIS is negated
 * (row 1, not row 0) because the element's own local axes are flipped
 * relative to the world's, and the leading translate centres the element
 * on its origin the way a mesh is centred on its own.
 *
 * `scale` maps the element's CSS pixels onto world units: author the
 * plane at a real device resolution (390×844 for an iPhone) and pass
 * `worldWidth / 390`, and one CSS pixel is one device pixel on the mesh.
 */
export function objectCss(world: Mat4, scale = 1): string {
  const m = world;
  return (
    'translate(-50%,-50%)' +
    `matrix3d(${e(m[0]!)},${e(m[1]!)},${e(m[2]!)},${e(m[3]!)},` +
    `${e(-m[4]!)},${e(-m[5]!)},${e(-m[6]!)},${e(-m[7]!)},` +
    `${e(m[8]!)},${e(m[9]!)},${e(m[10]!)},${e(m[11]!)},` +
    `${e(m[12]!)},${e(m[13]!)},${e(m[14]!)},${e(m[15]!)})` +
    (scale === 1 ? '' : `scale(${e(scale)})`)
  );
}
