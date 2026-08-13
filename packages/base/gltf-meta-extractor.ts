// Structure sniffer for the glTF family — both the JSON `.gltf` form and the
// binary `.glb` container, which wraps the same glTF JSON in a length-prefixed
// chunk. Unlike STL, a glTF describes itself: the JSON carries an accessor per
// vertex attribute whose `count` is the vertex total and whose `min`/`max` are
// the axis-aligned bounds, so the vertex/triangle counts and bounding box the
// spec asks for come straight from the header rather than from a geometry scan.
// The heavy buffers (a `.glb` BIN chunk, a `.gltf`'s external or base64 buffers)
// are never touched. Pure JS (DataView/TextDecoder/JSON), kept in a plain `.ts`
// module so it is directly unit-testable — mirroring `stl-meta-extractor.ts`.
// Returns `undefined` for anything that isn't glTF; the calling FileDef turns
// that into a `FileContentMismatchError` so the extractor falls back to the base
// FileDef.

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
  // The model-space bounding box, "X × Y × Z", derived from the union of the
  // POSITION accessors' min/max. glTF distances are nominally meters, but files
  // routinely ignore that, so it is presented unitless.
  dimensions?: string;
}

// 'glTF' and 'JSON' as little-endian uint32s — the GLB magic and its first
// chunk's type tag.
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;

// glTF primitive topology modes. Only the triangle families contribute faces;
// points and lines contribute none.
const MODE_TRIANGLES = 4;
const MODE_TRIANGLE_STRIP = 5;
const MODE_TRIANGLE_FAN = 6;

// Read the JSON chunk out of a GLB container without touching the BIN chunk that
// follows it, so a large binary model is described from its header alone.
function readGlbJson(buf: ArrayBuffer): unknown {
  if (buf.byteLength < 20) {
    return undefined;
  }
  let view = new DataView(buf);
  // Only glTF 2.0 defines the chunked binary container read here.
  if (view.getUint32(4, true) !== 2) {
    return undefined;
  }
  let chunkLength = view.getUint32(12, true);
  let chunkType = view.getUint32(16, true);
  // The spec requires the JSON chunk to come first.
  if (chunkType !== GLB_JSON_CHUNK || 20 + chunkLength > buf.byteLength) {
    return undefined;
  }
  try {
    return JSON.parse(
      new TextDecoder().decode(new Uint8Array(buf, 20, chunkLength)),
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

// Turn a parsed glTF document into the metadata we surface. Kept separate from
// the container decoding so both forms share exactly one analysis.
function analyzeGltf(
  doc: any,
  container: 'glb' | 'gltf',
): GltfMetadata | undefined {
  // Every glTF asset carries an `asset` object with a version; its absence is
  // the cheapest reliable "this isn't glTF" signal.
  if (!doc || typeof doc !== 'object' || !doc.asset) {
    return undefined;
  }
  let accessors: any[] = Array.isArray(doc.accessors) ? doc.accessors : [];
  let meshes: any[] = Array.isArray(doc.meshes) ? doc.meshes : [];

  let vertexCount = 0;
  let triangleCount = 0;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let haveBounds = false;

  for (let mesh of meshes) {
    let primitives: any[] = Array.isArray(mesh?.primitives)
      ? mesh.primitives
      : [];
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
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis]!, Number(position.min[axis]));
          max[axis] = Math.max(max[axis]!, Number(position.max[axis]));
        }
        haveBounds = true;
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
  }

  let metadata: GltfMetadata = { container };
  let version = doc.asset?.version;
  if (typeof version === 'string' && version) {
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
  if (haveBounds) {
    metadata.dimensions = `${round(max[0]! - min[0]!)} × ${round(
      max[1]! - min[1]!,
    )} × ${round(max[2]! - min[2]!)}`;
  }
  return metadata;
}

export function parseGltf(
  buf: ArrayBuffer,
): { gltfMetadata: GltfMetadata } | undefined {
  let container: 'glb' | 'gltf';
  let doc: unknown;
  if (
    buf.byteLength >= 12 &&
    new DataView(buf).getUint32(0, true) === GLB_MAGIC
  ) {
    container = 'glb';
    doc = readGlbJson(buf);
  } else {
    container = 'gltf';
    doc = decodeGltfJson(new Uint8Array(buf));
  }
  let metadata = analyzeGltf(doc, container);
  return metadata ? { gltfMetadata: metadata } : undefined;
}
