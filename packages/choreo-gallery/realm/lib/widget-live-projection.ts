import type * as THREE from 'three';

type Three = typeof THREE;
const localPlanes = new WeakMap<object, Map<string, THREE.Matrix4>>();
let viewportMatrix: THREE.Matrix4 | undefined;
/**
 * Project each DOM plane independently: no giant transformed UI ancestor.
 * `T` is the host's three.js, which the room loads before its first paint.
 */
export function projectLiveTile(
  T: Three,
  camera: THREE.PerspectiveCamera,
  viewportWidth: number,
  viewportHeight: number,
  pose: { x: number; y: number; yaw: number; z: number },
  width: number,
  height: number,
) {
  let sizes = localPlanes.get(pose);
  if (!sizes) {
    sizes = new Map();
    localPlanes.set(pose, sizes);
  }
  const key = `${width}:${height}`;
  let local = sizes.get(key);
  if (!local) {
    const object = new T.Object3D();
    object.position.set(pose.x, pose.y, pose.z);
    object.rotation.y = (pose.yaw * Math.PI) / 180;
    object.updateMatrixWorld();
    local = object.matrixWorld
      .multiply(new T.Matrix4().makeScale(1, -1, 1))
      .multiply(new T.Matrix4().makeTranslation(-width / 2, -height / 2, 0));
    sizes.set(key, local);
  }
  viewportMatrix ??= new T.Matrix4();
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
    1,
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
  const center = new T.Vector3(pose.x, pose.y, pose.z).project(camera);
  return {
    transform: `matrix3d(${css.map((n) => (Math.abs(n) < 1e-10 ? 0 : n)).join(',')})`,
    visible: inFront && Math.abs(center.x) < 2.4 && Math.abs(center.y) < 2.4,
    depth: normal,
    center,
  };
}
