import type { PerspectiveCamera } from 'three';
import { Matrix4, Object3D, Vector3 } from 'three';
const localPlanes = new WeakMap<object, Map<string, Matrix4>>();
const viewportMatrix = new Matrix4();
/** Project each DOM plane independently: no giant transformed UI ancestor. */
export function projectLiveTile(
  camera: PerspectiveCamera,
  viewportWidth: number,
  viewportHeight: number,
  pose: { x: number; y: number; yaw: number; z: number },
  width: number,
  height: number
) {
  let sizes = localPlanes.get(pose);
  if (!sizes) {
    sizes = new Map();
    localPlanes.set(pose, sizes);
  }
  const key = `${width}:${height}`;
  let local = sizes.get(key);
  if (!local) {
    const object = new Object3D();
    object.position.set(pose.x, pose.y, pose.z);
    object.rotation.y = (pose.yaw * Math.PI) / 180;
    object.updateMatrixWorld();
    local = object.matrixWorld
      .multiply(new Matrix4().makeScale(1, -1, 1))
      .multiply(new Matrix4().makeTranslation(-width / 2, -height / 2, 0));
    sizes.set(key, local);
  }
  const viewport = viewportMatrix.set(
    viewportWidth / 2,
    0,
    0,
    viewportWidth / 2,
    0,
    -viewportHeight / 2,
    0,
    viewportHeight / 2,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1
  );
  const matrix = viewport
    .multiply(camera.projectionMatrix)
    .multiply(camera.matrixWorldInverse)
    .multiply(local);
  const m = matrix.elements;
  const normal = m[15]!;
  const inFront = normal > 0;
  // The screen homography retains perspective within the plane; DOM siblings
  // supply independent raster bounds and explicit painter order.
  const css = [
    m[0]! / normal,
    m[1]! / normal,
    0,
    m[3]! / normal,
    m[4]! / normal,
    m[5]! / normal,
    0,
    m[7]! / normal,
    0,
    0,
    1,
    0,
    m[12]! / normal,
    m[13]! / normal,
    0,
    1,
  ];
  const center = new Vector3(pose.x, pose.y, pose.z).project(camera);
  return {
    transform: `matrix3d(${css.map((n) => (Math.abs(n) < 1e-10 ? 0 : n)).join(',')})`,
    visible: inFront && Math.abs(center.x) < 2.4 && Math.abs(center.y) < 2.4,
    depth: normal,
    center,
  };
}
