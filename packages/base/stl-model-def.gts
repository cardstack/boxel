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
import { parseStl, type StlMetadata } from './stl-meta-extractor';

// Project the STL header sniff onto the shared `model3d` field. An STL file is
// exactly one solid, so `meshes` is always 1 — which also keeps the isolated
// shell's `3D model` section visible for ASCII STL, whose header carries no
// facet count.
function stlToModel3d(s: StlMetadata): SerializedModel3d {
  return {
    format: s.encoding === 'binary' ? 'Binary STL' : 'ASCII STL',
    meshes: 1,
    triangles: s.facetCount,
    solidName: s.solidName,
    generator: s.binaryHeader,
    hasColorData: s.hasColorData ? true : undefined,
  };
}

export class StlDef extends ThreeDModelDef {
  static displayName = 'STL Mesh';
  static icon = File3dIcon;
  static acceptTypes = '.stl,model/stl,application/sla';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: {
      contentHash?: string;
      contentSize?: number;
      // Backstop bound on the bytes we're willing to sniff at index time,
      // threaded from the host (see `FileDefAttributesExtractor`); defaults to
      // the realm's standard file-size limit (`DEFAULT_FILE_SIZE_LIMIT_BYTES`),
      // the same ceiling the write path enforces, so the two stay in step.
      fileSizeLimitBytes?: number;
    } = {},
  ): Promise<SerializedFile<Partial<{ model3d: SerializedModel3d }>>> {
    let extension = getExtension(url);
    if (extension !== '.stl') {
      throw new FileContentMismatchError(
        `Expected .stl file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    // Over the size cap, skip the sniff but keep the StlDef type — the file
    // still renders via the live client-side viewer (which parses its own
    // geometry); it just has an empty inspector panel and the cube placeholder.
    // Do NOT throw FileContentMismatchError here: that would demote the file to
    // a plain FileDef and lose the 3D card entirely.
    let sizeCap = options.fileSizeLimitBytes ?? DEFAULT_FILE_SIZE_LIMIT_BYTES;
    if (bytes.byteLength > sizeCap) {
      console.warn(
        `[StlDef] skipping metadata extraction for ${url}: ${bytes.byteLength} bytes exceeds cap ${sizeCap}`,
      );
      return { ...base };
    }
    let parsed = parseStl(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    if (!parsed) {
      throw new FileContentMismatchError(
        'File does not contain parseable STL geometry',
      );
    }
    return { ...base, ...model3dAttributes(stlToModel3d(parsed.stlMetadata)) };
  }
}

export default StlDef;
