import File3dIcon from '@cardstack/boxel-icons/file-3d';
import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { DEFAULT_FILE_SIZE_LIMIT_BYTES } from '@cardstack/runtime-common/constants';
import {
  FileContentMismatchError,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import {
  ThreeDModelDef,
  getExtension,
  model3dAttributes,
  type SerializedModel3d,
} from './three-d-model-def';
import { parseGltf, type GltfMetadata } from './gltf-meta-extractor';

// Project the glTF header read onto the shared `model3d` field. A `.glb` is the
// same glTF document in a binary wrapper, so both leaves share this mapping and
// differ only in the container label. Unlike STL/3MF, a glTF header enumerates
// its scene graph directly, so vertex/dimension facts sit cheaply in the JSON
// chunk and are honest header-only answers.
function gltfToModel3d(g: GltfMetadata): SerializedModel3d {
  let containerLabel = g.container === 'glb' ? 'Binary glTF' : 'glTF JSON';
  return {
    format: g.gltfVersion
      ? `${containerLabel} ${g.gltfVersion}`
      : containerLabel,
    meshes: g.meshCount,
    triangles: g.triangleCount,
    vertices: g.vertexCount,
    materials: g.materialCount,
    nodes: g.nodeCount,
    animations: g.animationCount,
    textures: g.textureCount,
    dimensions: g.dimensions,
    generator: g.generator,
  };
}

// A shared extract step for both leaves: the container form is auto-detected by
// `parseGltf`, so the only per-format difference is which extension is
// accepted and how a parse failure is described.
async function extractGltfAttributes(
  expectedExtension: '.gltf' | '.glb',
  containerLabel: string,
  url: string,
  getStream: () => Promise<ByteStream>,
  options: {
    contentHash?: string;
    contentSize?: number;
    fileSizeLimitBytes?: number;
  },
): Promise<SerializedFile<Partial<{ model3d: SerializedModel3d }>>> {
  let extension = getExtension(url);
  if (extension !== expectedExtension) {
    throw new FileContentMismatchError(
      `Expected ${expectedExtension} file extension, got "${extension || 'none'}"`,
    );
  }

  let bytesPromise: Promise<Uint8Array> | undefined;
  let memoizedStream = async () => {
    bytesPromise ??= byteStreamToUint8Array(await getStream());
    return bytesPromise;
  };

  let base = await ThreeDModelDef.extractAttributes(
    url,
    memoizedStream,
    options,
  );
  let bytes = await memoizedStream();
  // Over the size cap, skip the sniff but keep the model type — the file still
  // renders via the live client-side viewer (which parses its own geometry);
  // it just has an empty inspector panel and the cube placeholder. Do NOT
  // throw FileContentMismatchError here: that would demote the file to a plain
  // FileDef and lose the 3D card entirely.
  let sizeCap = options.fileSizeLimitBytes ?? DEFAULT_FILE_SIZE_LIMIT_BYTES;
  if (bytes.byteLength > sizeCap) {
    console.warn(
      `[GltfModelDef] skipping metadata extraction for ${url}: ${bytes.byteLength} bytes exceeds cap ${sizeCap}`,
    );
    return { ...base };
  }
  let parsed = parseGltf(bytes);
  if (!parsed) {
    throw new FileContentMismatchError(
      `File does not contain a parseable ${containerLabel}`,
    );
  }
  return { ...base, ...model3dAttributes(gltfToModel3d(parsed.gltfMetadata)) };
}

// The JSON form (`.gltf`). Its buffers and textures may be external or embedded
// as base64; the header read here needs neither.
export class GltfDef extends ThreeDModelDef {
  static displayName = 'glTF Model';
  static icon = File3dIcon;
  static acceptTypes = '.gltf,model/gltf+json';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: {
      contentHash?: string;
      contentSize?: number;
      fileSizeLimitBytes?: number;
    } = {},
  ): Promise<SerializedFile<Partial<{ model3d: SerializedModel3d }>>> {
    return extractGltfAttributes(
      '.gltf',
      'glTF JSON document',
      url,
      getStream,
      options,
    );
  }
}

// The binary form (`.glb`). The same glTF document wrapped in a chunked
// container; `parseGltf` reads only its JSON chunk, never the geometry that
// follows.
export class GlbDef extends ThreeDModelDef {
  static displayName = 'glTF Binary Model';
  static icon = File3dIcon;
  static acceptTypes = '.glb,model/gltf-binary';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: {
      contentHash?: string;
      contentSize?: number;
      fileSizeLimitBytes?: number;
    } = {},
  ): Promise<SerializedFile<Partial<{ model3d: SerializedModel3d }>>> {
    return extractGltfAttributes(
      '.glb',
      'GLB container',
      url,
      getStream,
      options,
    );
  }
}

export default GltfDef;
