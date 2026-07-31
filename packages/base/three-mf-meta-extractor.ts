import { unzipSync, strFromU8 } from 'fflate';
import type { Model3dData } from './model-file-def';

// Bounded 3MF (OPC ZIP) parser. Unzips the package, parses the model part(s) and
// the optional slicer config, and returns the generic scene facts plus the
// 3MF-specific package metadata. Uses `fflate` (bundled dependency, not a CDN
// import) and the runtime `DOMParser` (available in the host/prerender Chromium).
// Kept in a plain `.ts` module (mirroring `png-meta-extractor.ts`) so it is
// directly unit-testable. Returns `undefined` for anything that isn't a
// parseable 3MF package — a non-ZIP payload, a package with no `.model` part, or
// malformed model XML — and the calling FileDef turns that into a
// `FileContentMismatchError`. (It intentionally does NOT import
// `FileContentMismatchError` itself: that lives in `card-api`, and pulling it in
// would drag the whole card-api module into this pure parser and its tests.)

interface ThreeMfPrintPartData {
  name?: string;
  extruder?: number;
  faceCount?: number;
}

export interface ThreeMfMetadata {
  unit?: string;
  language?: string;
  modelPart?: string;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  packageEntryCount?: number;
  objectCount?: number;
  buildItemCount?: number;
  componentCount?: number;
  textureCount?: number;
  materialResourceCount?: number;
  extensionCount?: number;
  extensions?: string[];
  title?: string;
  designer?: string;
  application?: string;
  bambuStudioVersion?: string;
  creationDate?: string;
  licenseTerms?: string;
  description?: string;
  plateCount?: number;
  printPartCount?: number;
  configuredFaceCount?: number;
  extruderCount?: number;
  materialNames?: string[];
  materialColors?: string[];
  printParts?: ThreeMfPrintPartData[];
}

export function parseThreeMf(
  buf: ArrayBuffer,
): { model3d: Model3dData; threeMfMetadata: ThreeMfMetadata } | undefined {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf)) as Record<string, Uint8Array>;
  } catch {
    // Not a valid ZIP / OPC package.
    return undefined;
  }
  let modelPart = Object.keys(files).find((path) => /\.model$/i.test(path));
  if (!modelPart) {
    return undefined;
  }
  let modelDocuments: { path: string; document: Document; root: Element }[] =
    [];
  for (let [path, bytes] of Object.entries(files)) {
    if (!/\.model$/i.test(path)) {
      continue;
    }
    let document = new DOMParser().parseFromString(
      strFromU8(bytes),
      'application/xml',
    );
    if (document.getElementsByTagName('parsererror').length) {
      // Malformed model XML — treat the whole package as unparseable.
      return undefined;
    }
    modelDocuments.push({ path, document, root: document.documentElement });
  }
  let primary =
    modelDocuments.find(({ path }) => path === modelPart) ?? modelDocuments[0];
  let root = primary.root;
  let elements = (name: string) =>
    modelDocuments.flatMap(({ document }) =>
      Array.from(document.getElementsByTagNameNS('*', name)),
    );
  let metadata = new Map<string, string>();
  for (let element of elements('metadata')) {
    let key = element.getAttribute('name');
    if (key) {
      metadata.set(key.toLowerCase(), element.textContent?.trim() ?? '');
    }
  }
  let extensions = Array.from(
    new Set(
      modelDocuments.flatMap(({ root }) =>
        Array.from(root.attributes)
          .filter((attribute) => attribute.name.startsWith('xmlns:'))
          .map(
            (attribute) => `${attribute.name.slice(6)} · ${attribute.value}`,
          ),
      ),
    ),
  );
  let materialResourceCount = [
    'basematerials',
    'colorgroup',
    'texture2dgroup',
    'compositematerials',
    'multiproperties',
  ].reduce((total, name) => total + elements(name).length, 0);
  let materialBases = elements('base');
  let materialNames = materialBases
    .map((element) => element.getAttribute('name'))
    .filter((value): value is string => Boolean(value));
  let materialColors = materialBases
    .map((element) => element.getAttribute('displaycolor'))
    .filter((value): value is string => Boolean(value));
  let vertices = elements('vertex')
    .map((element) =>
      ['x', 'y', 'z'].map((axis) => Number(element.getAttribute(axis))),
    )
    .filter((vertex) => vertex.every(Number.isFinite));
  let mins = [Infinity, Infinity, Infinity];
  let maxs = [-Infinity, -Infinity, -Infinity];
  for (let vertex of vertices) {
    for (let axis = 0; axis < 3; axis++) {
      mins[axis] = Math.min(mins[axis], vertex[axis]);
      maxs[axis] = Math.max(maxs[axis], vertex[axis]);
    }
  }
  let dimension = (axis: number) =>
    vertices.length
      ? Math.round((maxs[axis] - mins[axis]) * 1_000_000) / 1_000_000
      : undefined;
  let configPath = Object.keys(files).find((path) =>
    /(?:^|\/)model_settings\.config$/i.test(path),
  );
  let configuredParts: ThreeMfPrintPartData[] = [];
  let plateCount = 0;
  let configuredFaceCount = 0;
  let extruders = new Set<number>();
  if (configPath) {
    let config = new DOMParser().parseFromString(
      strFromU8(files[configPath]),
      'application/xml',
    );
    if (!config.getElementsByTagName('parsererror').length) {
      plateCount = config.getElementsByTagName('plate').length;
      for (let part of Array.from(config.getElementsByTagName('part'))) {
        let values = new Map<string, string>();
        for (let child of Array.from(part.children)) {
          if (child.localName === 'metadata') {
            let key = child.getAttribute('key');
            if (key) {
              values.set(key, child.getAttribute('value') ?? '');
            }
          }
        }
        let meshStat = Array.from(part.children).find(
          (child) => child.localName === 'mesh_stat',
        );
        let faceCount = Number(meshStat?.getAttribute('face_count') ?? 0);
        let extruder = Number(values.get('extruder') ?? 0);
        if (extruder > 0) {
          extruders.add(extruder);
        }
        configuredFaceCount += Number.isFinite(faceCount) ? faceCount : 0;
        configuredParts.push({
          name:
            values.get('name') ||
            `Part ${part.getAttribute('id') ?? configuredParts.length + 1}`,
          extruder: extruder || undefined,
          faceCount: faceCount || undefined,
        });
      }
    }
  }
  if (!configuredParts.length) {
    for (let object of elements('object')) {
      let triangleCount = object.getElementsByTagNameNS('*', 'triangle').length;
      if (triangleCount) {
        configuredParts.push({
          name:
            object.getAttribute('name') ||
            `Object ${object.getAttribute('id') ?? configuredParts.length + 1}`,
          faceCount: triangleCount,
        });
      }
    }
  }
  let application =
    metadata.get('application') ??
    metadata.get('producer') ??
    metadata.get('generator');
  return {
    model3d: {
      meshes: elements('mesh').length,
      materials: materialResourceCount,
      vertices: elements('vertex').length,
      triangles: elements('triangle').length,
      generator: application ?? metadata.get('designer'),
    },
    threeMfMetadata: {
      unit: root.getAttribute('unit') ?? 'millimeter',
      language: root.getAttribute('xml:lang') ?? undefined,
      modelPart,
      sizeX: dimension(0),
      sizeY: dimension(1),
      sizeZ: dimension(2),
      packageEntryCount: Object.keys(files).length,
      objectCount: elements('object').length,
      buildItemCount: elements('item').length,
      componentCount: elements('component').length,
      textureCount: elements('texture2d').length,
      materialResourceCount,
      extensionCount: extensions.length,
      extensions,
      title: metadata.get('title'),
      designer: metadata.get('designer'),
      application,
      bambuStudioVersion: metadata.get('bambustudio:3mfversion'),
      creationDate: metadata.get('creationdate'),
      licenseTerms: metadata.get('licenseterms'),
      description: metadata.get('description'),
      plateCount: plateCount || undefined,
      printPartCount: configuredParts.length || undefined,
      configuredFaceCount: configuredFaceCount || undefined,
      extruderCount: extruders.size || undefined,
      materialNames,
      materialColors,
      printParts: configuredParts,
    },
  };
}
