// Structure sniffer for the glTF family — both the JSON `.gltf` form and the
// binary `.glb` container, which wraps the same glTF JSON in a length-prefixed
// chunk. Unlike STL, a glTF describes itself: the JSON carries an accessor per
// vertex attribute whose `count` is the vertex total and whose `min`/`max` are
// the axis-aligned bounds, and the scene graph's node transforms are plain JSON
// too — so the vertex/triangle counts and bounding box the spec asks for come
// from the header rather than from a geometry scan. The heavy buffers (a
// `.glb` BIN chunk, a `.gltf`'s external or base64 buffers) are never parsed;
// the caller has already buffered the file's bytes either way, but the
// analysis cost here is independent of geometry size. Pure JS
// (DataView/TextDecoder/JSON), kept in a plain `.ts` module so it is directly
// unit-testable — mirroring `stl-meta-extractor.ts`. Returns `undefined` for
// anything that isn't glTF; the calling FileDef turns that into a
// `FileContentMismatchError` so the extractor falls back to the base FileDef.

export interface GltfMetadata {
  // Which form the bytes took: the binary `.glb` container or raw `.gltf` JSON.
  container: 'glb' | 'gltf';
  // `asset.version` — "2.0" for every modern glTF.
  gltfVersion?: string;
  // `asset.generator` — the exporting tool, when it named itself.
  generator?: string;
  meshCount?: number;
  materialCount?: number;
  nodeCount?: number;
  animationCount?: number;
  textureCount?: number;
  // Summed across every mesh primitive's POSITION accessor.
  vertexCount?: number;
  // Summed across primitives, honoring each one's topology mode.
  triangleCount?: number;
  // The model-space bounding box, "X × Y × Z": each mesh's POSITION bounds are
  // placed through the scene graph's node transforms (matrix or TRS, composed
  // down the hierarchy), so scaled, translated, and instanced meshes report
  // the extent of the assembled scene. Documents with no scene graph fall back
  // to the mesh-space union. glTF distances are nominally meters, but files
  // routinely ignore that, so it is presented unitless.
  dimensions?: string;
}

// 'glTF' and 'JSON' as little-endian uint32s — the GLB magic and its first
// chunk's type tag.
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;

// A cheap "is this the binary glTF container?" test: the 4-byte GLB magic at
// offset 0. True does not mean the container is *readable* (it may be glTF 1.0,
// truncated, or have its chunks out of order) — only that the bytes announce
// themselves as a GLB. The call site uses this to tell a real-but-unsummarizable
// `.glb` (keep the 3D card) apart from bytes that aren't glTF at all (fall back
// to a plain FileDef).
export function isGlbContainer(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      0,
      true,
    ) === GLB_MAGIC
  );
}

// glTF primitive topology modes. Only the triangle families contribute faces;
// points and lines contribute none.
const MODE_TRIANGLES = 4;
const MODE_TRIANGLE_STRIP = 5;
const MODE_TRIANGLE_FAN = 6;

// Read the JSON chunk out of a GLB container without touching the BIN chunk that
// follows it, so a large binary model is described from its header alone.
function readGlbJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength < 20) {
    return undefined;
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Only glTF 2.0 defines the chunked binary container read here.
  if (view.getUint32(4, true) !== 2) {
    return undefined;
  }
  let chunkLength = view.getUint32(12, true);
  let chunkType = view.getUint32(16, true);
  // The spec requires the JSON chunk to come first.
  if (chunkType !== GLB_JSON_CHUNK || 20 + chunkLength > bytes.byteLength) {
    return undefined;
  }
  try {
    return JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(bytes.buffer, bytes.byteOffset + 20, chunkLength),
      ),
    );
  } catch {
    return undefined;
  }
}

function decodeGltfJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// Fold a mesh primitive's element count into a triangle total per its topology.
function trianglesFor(mode: number, elementCount: number): number {
  if (mode === MODE_TRIANGLES) {
    return Math.floor(elementCount / 3);
  }
  if (mode === MODE_TRIANGLE_STRIP || mode === MODE_TRIANGLE_FAN) {
    return Math.max(0, elementCount - 2);
  }
  return 0;
}

interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

// 4×4 matrix as a 16-element column-major array — glTF's own `node.matrix`
// convention, so a file-supplied matrix is used as-is.
type Mat4 = number[];

// prettier-ignore
const IDENTITY: Mat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function multiply(a: Mat4, b: Mat4): Mat4 {
  let out = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row]! * b[col * 4 + k]!;
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

// A node's local transform: its explicit `matrix`, or its TRS triple composed
// as T·R·S per the spec (scale first, then rotate, then translate).
function localMatrix(node: any): Mat4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return node.matrix.map(Number);
  }
  let [tx, ty, tz] = Array.isArray(node.translation)
    ? node.translation.map(Number)
    : [0, 0, 0];
  let [rx, ry, rz, rw] = Array.isArray(node.rotation)
    ? node.rotation.map(Number)
    : [0, 0, 0, 1];
  let [sx, sy, sz] = Array.isArray(node.scale)
    ? node.scale.map(Number)
    : [1, 1, 1];
  // Rotation matrix from the unit quaternion, columns scaled by S, translation
  // in the fourth column — i.e. T·R·S already multiplied out.
  // prettier-ignore
  return [
    (1 - 2 * (ry * ry + rz * rz)) * sx, (2 * (rx * ry + rz * rw)) * sx, (2 * (rx * rz - ry * rw)) * sx, 0,
    (2 * (rx * ry - rz * rw)) * sy, (1 - 2 * (rx * rx + rz * rz)) * sy, (2 * (ry * rz + rx * rw)) * sy, 0,
    (2 * (rx * rz + ry * rw)) * sz, (2 * (ry * rz - rx * rw)) * sz, (1 - 2 * (rx * rx + ry * ry)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

// Accessor min/max are mesh-local; nodes place meshes into the scene, so the
// model-space box is the union of every node instance's transformed corners.
// Walks the default scene's roots, composing each node's transform into its
// parent's and folding the eight corners of a mesh-bearing node's AABB. The
// visited set guards against malformed self-referencing graphs (the spec
// requires nodes to form disjoint trees, so revisiting is never legitimate).
function sceneBounds(
  doc: any,
  meshBounds: (Aabb | undefined)[],
): Aabb | undefined {
  let nodes: any[] = Array.isArray(doc.nodes) ? doc.nodes : [];
  let scenes: any[] = Array.isArray(doc.scenes) ? doc.scenes : [];
  let sceneIndex = typeof doc.scene === 'number' ? doc.scene : 0;
  let roots: unknown[] = Array.isArray(scenes[sceneIndex]?.nodes)
    ? scenes[sceneIndex].nodes
    : [];

  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let haveBounds = false;
  let visited = new Set<number>();

  let visit = (index: unknown, parent: Mat4) => {
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= nodes.length ||
      visited.has(index)
    ) {
      return;
    }
    visited.add(index);
    let node = nodes[index];
    if (!node || typeof node !== 'object') {
      return;
    }
    let world = multiply(parent, localMatrix(node));
    let bounds =
      typeof node.mesh === 'number' ? meshBounds[node.mesh] : undefined;
    if (bounds) {
      for (let corner = 0; corner < 8; corner++) {
        let x = corner & 1 ? bounds.max[0] : bounds.min[0];
        let y = corner & 2 ? bounds.max[1] : bounds.min[1];
        let z = corner & 4 ? bounds.max[2] : bounds.min[2];
        let wx = world[0]! * x + world[4]! * y + world[8]! * z + world[12]!;
        let wy = world[1]! * x + world[5]! * y + world[9]! * z + world[13]!;
        let wz = world[2]! * x + world[6]! * y + world[10]! * z + world[14]!;
        if (Number.isFinite(wx) && Number.isFinite(wy) && Number.isFinite(wz)) {
          min[0] = Math.min(min[0], wx);
          min[1] = Math.min(min[1], wy);
          min[2] = Math.min(min[2], wz);
          max[0] = Math.max(max[0], wx);
          max[1] = Math.max(max[1], wy);
          max[2] = Math.max(max[2], wz);
          haveBounds = true;
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (let child of node.children) {
        visit(child, world);
      }
    }
  };

  for (let root of roots) {
    visit(root, IDENTITY);
  }
  return haveBounds ? { min, max } : undefined;
}

// Turn a parsed glTF document into the metadata we surface. Kept separate from
// the container decoding so both forms share exactly one analysis.
function analyzeGltf(
  doc: any,
  container: 'glb' | 'gltf',
): GltfMetadata | undefined {
  // Every glTF asset carries an `asset` object with a version string; its
  // absence is the cheapest reliable "this isn't glTF" signal.
  if (
    !doc ||
    typeof doc !== 'object' ||
    typeof doc.asset?.version !== 'string'
  ) {
    return undefined;
  }
  let accessors: any[] = Array.isArray(doc.accessors) ? doc.accessors : [];
  let meshes: any[] = Array.isArray(doc.meshes) ? doc.meshes : [];

  let vertexCount = 0;
  let triangleCount = 0;
  let meshBounds: (Aabb | undefined)[] = [];

  for (let mesh of meshes) {
    let primitives: any[] = Array.isArray(mesh?.primitives)
      ? mesh.primitives
      : [];
    let bounds: Aabb | undefined;
    for (let primitive of primitives) {
      let positionIndex = primitive?.attributes?.POSITION;
      let position =
        typeof positionIndex === 'number'
          ? accessors[positionIndex]
          : undefined;
      let positionCount = Number(position?.count) || 0;
      vertexCount += positionCount;

      if (
        Array.isArray(position?.min) &&
        Array.isArray(position?.max) &&
        position.min.length >= 3 &&
        position.max.length >= 3
      ) {
        let lo = [0, 1, 2].map((axis) => Number(position.min[axis]));
        let hi = [0, 1, 2].map((axis) => Number(position.max[axis]));
        if ([...lo, ...hi].every(Number.isFinite)) {
          bounds ??= {
            min: [Infinity, Infinity, Infinity],
            max: [-Infinity, -Infinity, -Infinity],
          };
          for (let axis = 0; axis < 3; axis++) {
            bounds.min[axis] = Math.min(bounds.min[axis]!, lo[axis]!);
            bounds.max[axis] = Math.max(bounds.max[axis]!, hi[axis]!);
          }
        }
      }

      // Indexed geometry counts its index accessor; a non-indexed primitive
      // draws its POSITION vertices directly.
      let mode =
        typeof primitive?.mode === 'number' ? primitive.mode : MODE_TRIANGLES;
      let indexAccessor =
        typeof primitive?.indices === 'number'
          ? accessors[primitive.indices]
          : undefined;
      let elementCount = indexAccessor
        ? Number(indexAccessor.count) || 0
        : positionCount;
      triangleCount += trianglesFor(mode, elementCount);
    }
    meshBounds.push(bounds);
  }

  // Prefer the scene graph's placement of the meshes; a document with no scene
  // graph (or one that reaches no bounded mesh) falls back to the union of the
  // mesh-space bounds, which is then also the model space.
  let box = sceneBounds(doc, meshBounds);
  if (!box) {
    for (let bounds of meshBounds) {
      if (!bounds) {
        continue;
      }
      box ??= {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
      };
      for (let axis = 0; axis < 3; axis++) {
        box.min[axis] = Math.min(box.min[axis]!, bounds.min[axis]!);
        box.max[axis] = Math.max(box.max[axis]!, bounds.max[axis]!);
      }
    }
  }

  let metadata: GltfMetadata = { container };
  let version = doc.asset.version;
  if (version) {
    metadata.gltfVersion = version;
  }
  let generator = doc.asset?.generator;
  if (typeof generator === 'string' && generator) {
    metadata.generator = generator;
  }
  if (meshes.length) {
    metadata.meshCount = meshes.length;
  }
  if (Array.isArray(doc.materials) && doc.materials.length) {
    metadata.materialCount = doc.materials.length;
  }
  if (Array.isArray(doc.nodes) && doc.nodes.length) {
    metadata.nodeCount = doc.nodes.length;
  }
  if (Array.isArray(doc.animations) && doc.animations.length) {
    metadata.animationCount = doc.animations.length;
  }
  if (Array.isArray(doc.textures) && doc.textures.length) {
    metadata.textureCount = doc.textures.length;
  }
  if (vertexCount > 0) {
    metadata.vertexCount = vertexCount;
  }
  if (triangleCount > 0) {
    metadata.triangleCount = triangleCount;
  }
  if (box) {
    metadata.dimensions = `${round(box.max[0] - box.min[0])} × ${round(
      box.max[1] - box.min[1],
    )} × ${round(box.max[2] - box.min[2])}`;
  }
  return metadata;
}

export function parseGltf(
  bytes: Uint8Array,
): { gltfMetadata: GltfMetadata } | undefined {
  let container: 'glb' | 'gltf';
  let doc: unknown;
  if (isGlbContainer(bytes)) {
    container = 'glb';
    doc = readGlbJson(bytes);
  } else {
    container = 'gltf';
    doc = decodeGltfJson(bytes);
  }
  let metadata = analyzeGltf(doc, container);
  return metadata ? { gltfMetadata: metadata } : undefined;
}
