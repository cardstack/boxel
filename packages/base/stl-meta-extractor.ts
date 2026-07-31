import type { Model3dData } from './model-file-def';

// Bounded, allocation-light STL parser. Pure JS (DataView/TextDecoder) so it
// runs identically in the browser, the indexer, and the prerender pass — kept in
// a plain `.ts` module (mirroring `png-meta-extractor.ts`) so it is directly
// unit-testable without the card-api/`.gts` harness. Computes the bounding box
// and facet/vertex diagnostics in a single streaming pass and never materializes
// a per-vertex array, so transient memory stays flat regardless of model size.
// Returns `undefined` for anything that isn't parseable STL geometry; the
// calling FileDef turns that into a `FileContentMismatchError` so the extractor
// falls back to the base FileDef.

export interface StlMetadata {
  encoding: string;
  solidName?: string;
  binaryHeader?: string;
  facetCount: number;
  normalCount: number;
  degenerateFacetCount: number;
  hasColorData: boolean;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

// A facet whose three vertices are (near-)colinear has ~zero cross-product area.
const DEGENERATE_CROSS_SQ = 1e-20;
// A facet normal below this magnitude is treated as absent (STL allows a zero
// normal, signalling "compute it from the winding").
const NORMAL_MAGNITUDE_MIN = 1e-12;

function isDegenerateFacet(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
): boolean {
  let abx = b[0] - a[0];
  let aby = b[1] - a[1];
  let abz = b[2] - a[2];
  let acx = c[0] - a[0];
  let acy = c[1] - a[1];
  let acz = c[2] - a[2];
  let cx = aby * acz - abz * acy;
  let cy = abz * acx - abx * acz;
  let cz = abx * acy - aby * acx;
  return cx ** 2 + cy ** 2 + cz ** 2 < DEGENERATE_CROSS_SQ;
}

export function parseStl(
  buf: ArrayBuffer,
): { model3d: Model3dData; stlMetadata: StlMetadata } | undefined {
  let bytes = new Uint8Array(buf);
  let view = new DataView(buf);
  let declaredBinaryFacets = bytes.length >= 84 ? view.getUint32(80, true) : 0;
  let expectedBinarySize = 84 + declaredBinaryFacets * 50;
  let isBinary = declaredBinaryFacets > 0 && expectedBinarySize <= bytes.length;

  let mins = [Infinity, Infinity, Infinity];
  let maxs = [-Infinity, -Infinity, -Infinity];
  let finiteVertexCount = 0;
  let normalCount = 0;
  let facetCount = 0;
  let degenerateFacetCount = 0;
  let hasColorData = false;
  let solidName: string | undefined;
  let binaryHeader: string | undefined;

  // Fold one vertex into the running bounding box; ignores non-finite
  // coordinates so a stray NaN can't poison the extents.
  let addVertex = (x: number, y: number, z: number) => {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) {
      return;
    }
    finiteVertexCount++;
    if (x < mins[0]) mins[0] = x;
    if (x > maxs[0]) maxs[0] = x;
    if (y < mins[1]) mins[1] = y;
    if (y > maxs[1]) maxs[1] = y;
    if (z < mins[2]) mins[2] = z;
    if (z > maxs[2]) maxs[2] = z;
  };

  // Count a facet as degenerate only when all three vertices are finite, so the
  // per-facet grouping never drifts (the bug in the pre-streaming version: it
  // filtered non-finite vertices out of a flat list, then regrouped by 3, which
  // misaligned facet boundaries whenever any vertex was dropped).
  let countFacetGeometry = (tri: readonly number[][]) => {
    if (
      tri.every((v) => v.every(Number.isFinite)) &&
      isDegenerateFacet(tri[0], tri[1], tri[2])
    ) {
      degenerateFacetCount++;
    }
  };

  if (isBinary) {
    binaryHeader =
      new TextDecoder('latin1')
        .decode(bytes.subarray(0, 80))
        .split('')
        .map((character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) > 126
            ? ' '
            : character,
        )
        .join('')
        .trim() || undefined;
    hasColorData = /COLOR=/i.test(binaryHeader ?? '');
    facetCount = Math.min(
      declaredBinaryFacets,
      Math.floor((bytes.length - 84) / 50),
    );
    for (let facet = 0; facet < facetCount; facet++) {
      let offset = 84 + facet * 50;
      let nx = view.getFloat32(offset, true);
      let ny = view.getFloat32(offset + 4, true);
      let nz = view.getFloat32(offset + 8, true);
      if (
        Number.isFinite(nx + ny + nz) &&
        Math.abs(nx) + Math.abs(ny) + Math.abs(nz) > NORMAL_MAGNITUDE_MIN
      ) {
        normalCount++;
      }
      // A short-lived per-facet triple (GC'd immediately) — this keeps live
      // memory O(1) rather than accumulating one array per vertex.
      let tri: number[][] = [];
      for (let vertex = 0; vertex < 3; vertex++) {
        let p = offset + 12 + vertex * 12;
        let x = view.getFloat32(p, true);
        let y = view.getFloat32(p + 4, true);
        let z = view.getFloat32(p + 8, true);
        addVertex(x, y, z);
        tri.push([x, y, z]);
      }
      countFacetGeometry(tri);
      hasColorData ||= view.getUint16(offset + 48, true) !== 0;
    }
  } else {
    let text = new TextDecoder().decode(bytes);
    if (
      !/\bfacet\s+normal\b/i.test(text) ||
      !/\bvertex\s+[-+\d.]/i.test(text)
    ) {
      return undefined;
    }
    solidName =
      text.match(/^\s*solid(?:\s+([^\r\n]+))?/i)?.[1]?.trim() || undefined;
    let normalPattern =
      /\bfacet\s+normal\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi;
    for (let match; (match = normalPattern.exec(text)); ) {
      facetCount++;
      let magnitude =
        Math.abs(Number(match[1])) +
        Math.abs(Number(match[2])) +
        Math.abs(Number(match[3]));
      if (Number.isFinite(magnitude) && magnitude > NORMAL_MAGNITUDE_MIN) {
        normalCount++;
      }
    }
    // Walk vertices in file order, grouping every 3 into a facet as they arrive
    // (a rolling 3-slot buffer — never the whole vertex list).
    let vertexPattern =
      /\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi;
    let tri: number[][] = [];
    for (let match; (match = vertexPattern.exec(text)); ) {
      let x = Number(match[1]);
      let y = Number(match[2]);
      let z = Number(match[3]);
      addVertex(x, y, z);
      tri.push([x, y, z]);
      if (tri.length === 3) {
        countFacetGeometry(tri);
        tri = [];
      }
    }
  }

  if (!facetCount || finiteVertexCount < 3) {
    return undefined;
  }
  let round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return {
    model3d: {
      meshes: 1,
      materials: hasColorData ? 1 : 0,
      vertices: finiteVertexCount,
      triangles: facetCount,
      generator: solidName ?? binaryHeader,
    },
    stlMetadata: {
      encoding: isBinary ? 'binary' : 'ASCII',
      solidName,
      binaryHeader,
      facetCount,
      normalCount,
      degenerateFacetCount,
      hasColorData,
      sizeX: round(maxs[0] - mins[0]),
      sizeY: round(maxs[1] - mins[1]),
      sizeZ: round(maxs[2] - mins[2]),
    },
  };
}
