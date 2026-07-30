// @ts-expect-error Runtime ESM import is resolved by the realm.
import * as THREE from 'https://esm.sh/three@0.160.0';
// Keep this import on one line so the TypeScript suppression stays attached.
// prettier-ignore
// @ts-expect-error Runtime ESM import is resolved by the realm.
import { Brush, Evaluator, SUBTRACTION } from "https://esm.sh/three-bvh-csg@0.0.16?deps=three@0.160.0";

// 🧩 PATTERN: prepare raised or flat/flush, manifold, color-mapped parts for 3MF export.

export type FabricationFinish = 'raised' | 'flush';

export interface FabricationSettings {
  finish: FabricationFinish;
  width: number;
  height: number;
  backingDepth: number;
  featureDepth: number;
  overlap: number;
  cutterOvertravel: number;
}

export interface PrintablePart {
  name: string;
  color: string;
  mesh: THREE.Mesh;
  expectedZ: readonly [number, number];
}

export interface WeldedMeshData {
  vertices: Array<readonly [number, number, number]>;
  triangles: Array<readonly [number, number, number]>;
}

export interface Prepared3MFPart extends WeldedMeshData {
  name: string;
  color: string;
  extruder: number;
}

const evaluator = new Evaluator();

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

export function assertOrientationPreservingScale(mesh: THREE.Mesh): void {
  mesh.updateMatrixWorld(true);
  if (mesh.matrixWorld.determinant() <= 0) {
    throw new Error(
      'Printable meshes cannot use mirrored or zero-scale transforms',
    );
  }
}

function centeredBox(
  width: number,
  height: number,
  depth: number,
  centerZ: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth));
  mesh.position.z = centerZ;
  mesh.updateMatrixWorld(true);
  return mesh;
}

/**
 * Raised: the feature overlaps an uncut backing.
 * Flush: a deeper cutter removes the feature volume from the backing.
 */
export function buildSampleAssembly(
  settings: FabricationSettings,
): PrintablePart[] {
  positive(settings.width, 'width');
  positive(settings.height, 'height');
  positive(settings.backingDepth, 'backingDepth');
  positive(settings.featureDepth, 'featureDepth');
  positive(settings.overlap, 'overlap');
  positive(settings.cutterOvertravel, 'cutterOvertravel');

  const surfaceZ = settings.backingDepth;
  const featureWidth = settings.width * 0.46;
  const featureHeight = settings.height * 0.34;
  const backing = centeredBox(
    settings.width,
    settings.height,
    settings.backingDepth,
    settings.backingDepth / 2,
  );

  if (settings.finish === 'raised') {
    const featureBottom = surfaceZ - settings.overlap;
    const featureTotalDepth = settings.featureDepth + settings.overlap;
    const feature = centeredBox(
      featureWidth,
      featureHeight,
      featureTotalDepth,
      featureBottom + featureTotalDepth / 2,
    );

    return [
      {
        name: 'backing',
        color: '#263238',
        mesh: backing,
        expectedZ: [0, surfaceZ],
      },
      {
        name: 'feature',
        color: '#F2C94C',
        mesh: feature,
        expectedZ: [featureBottom, surfaceZ + settings.featureDepth],
      },
    ];
  }

  const inlay = centeredBox(
    featureWidth,
    featureHeight,
    settings.featureDepth,
    surfaceZ - settings.featureDepth / 2,
  );
  const cutterDepth = settings.featureDepth + 2 * settings.cutterOvertravel;
  const cutter = centeredBox(
    featureWidth,
    featureHeight,
    cutterDepth,
    surfaceZ - settings.featureDepth / 2,
  );

  const backingBrush = new Brush(backing.geometry);
  backingBrush.position.copy(backing.position);
  backingBrush.updateMatrixWorld(true);
  const cutterBrush = new Brush(cutter.geometry);
  cutterBrush.position.copy(cutter.position);
  cutterBrush.updateMatrixWorld(true);
  const cutBacking = evaluator.evaluate(backingBrush, cutterBrush, SUBTRACTION);
  cutBacking.updateMatrixWorld(true);

  return [
    {
      name: 'backing-with-cavity',
      color: '#263238',
      mesh: cutBacking,
      expectedZ: [0, surfaceZ],
    },
    {
      name: 'flush-inlay',
      color: '#F2C94C',
      mesh: inlay,
      expectedZ: [surfaceZ - settings.featureDepth, surfaceZ],
    },
  ];
}

function quantizedKey(point: THREE.Vector3, precision: number): string {
  return [point.x, point.y, point.z]
    .map((value) => Math.round(value / precision))
    .join(':');
}

export function weldedMeshData(
  mesh: THREE.Mesh,
  precision = 1e-5,
): WeldedMeshData {
  positive(precision, 'precision');
  assertOrientationPreservingScale(mesh);

  const geometry = mesh.geometry;
  const positions = geometry.getAttribute('position');
  if (!positions) {
    throw new Error('Printable mesh is missing a position attribute');
  }

  const sourceIndices = geometry.index
    ? Array.from(geometry.index.array, Number)
    : Array.from({ length: positions.count }, (_, index) => index);
  const vertices: Array<readonly [number, number, number]> = [];
  const vertexIndexByKey = new Map<string, number>();
  const weldedIndexBySource = new Map<number, number>();

  const weldedIndex = (sourceIndex: number): number => {
    const existingSource = weldedIndexBySource.get(sourceIndex);
    if (existingSource !== undefined) {
      return existingSource;
    }

    const point = new THREE.Vector3().fromBufferAttribute(
      positions,
      sourceIndex,
    );
    point.applyMatrix4(mesh.matrixWorld);
    const key = quantizedKey(point, precision);
    let index = vertexIndexByKey.get(key);
    if (index === undefined) {
      index = vertices.length;
      vertices.push([point.x, point.y, point.z]);
      vertexIndexByKey.set(key, index);
    }
    weldedIndexBySource.set(sourceIndex, index);
    return index;
  };

  const triangles: Array<readonly [number, number, number]> = [];
  for (let offset = 0; offset + 2 < sourceIndices.length; offset += 3) {
    const a = weldedIndex(sourceIndices[offset]!);
    const b = weldedIndex(sourceIndices[offset + 1]!);
    const c = weldedIndex(sourceIndices[offset + 2]!);
    if (a !== b && b !== c && c !== a) {
      triangles.push([a, b, c]);
    }
  }

  return { vertices, triangles };
}

export function topologyProblems(data: WeldedMeshData): string[] {
  const edgeUses = new Map<string, number>();
  for (const [a, b, c] of data.triangles) {
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const edge = from < to ? `${from}:${to}` : `${to}:${from}`;
      edgeUses.set(edge, (edgeUses.get(edge) ?? 0) + 1);
    }
  }

  const openEdges = [...edgeUses.values()].filter(
    (count) => count === 1,
  ).length;
  const nonManifoldEdges = [...edgeUses.values()].filter(
    (count) => count > 2,
  ).length;
  const problems: string[] = [];
  if (openEdges > 0) problems.push(`${openEdges} open edges`);
  if (nonManifoldEdges > 0)
    problems.push(`${nonManifoldEdges} non-manifold edges`);
  if (data.triangles.length === 0) problems.push('no printable triangles');
  return problems;
}

export function assertZBounds(
  data: WeldedMeshData,
  expected: readonly [number, number],
  tolerance = 1e-4,
): void {
  const z = data.vertices.map((vertex) => vertex[2]);
  const actual: readonly [number, number] = [Math.min(...z), Math.max(...z)];
  if (
    Math.abs(actual[0] - expected[0]) > tolerance ||
    Math.abs(actual[1] - expected[1]) > tolerance
  ) {
    throw new Error(
      `Unexpected Z bounds: expected ${expected.join('..')}, got ${actual.join(
        '..',
      )}`,
    );
  }
}

function normalizedColor(input: string): string {
  return `#${new THREE.Color(input).getHexString().toUpperCase()}`;
}

/** Return only validated data to the XML/ZIP layer. */
export function prepare3MFInput(parts: PrintablePart[]): Prepared3MFPart[] {
  const extruderByColor = new Map<string, number>();

  return parts.map((part) => {
    const color = normalizedColor(part.color);
    if (!extruderByColor.has(color)) {
      extruderByColor.set(color, extruderByColor.size + 1);
    }

    const data = weldedMeshData(part.mesh);
    const problems = topologyProblems(data);
    if (problems.length > 0) {
      throw new Error(
        `${part.name} is not a closed manifold: ${problems.join(', ')}`,
      );
    }
    assertZBounds(data, part.expectedZ);

    return {
      name: part.name,
      color,
      extruder: extruderByColor.get(color)!,
      ...data,
    };
  });
}
